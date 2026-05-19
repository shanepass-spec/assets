// tab-cc-to-pco-sync.js
// Syncs Constant Contact contacts → Planning Center Online (PCO)
// Runs on a schedule (every hour via Cloudflare Cron Trigger)
// Also has manual trigger via GET /sync
// Handles: new subscribers, list-based tagging, deduplication

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── CONSTANT CONTACT API ───────────────────────────────────────────────────────

async function getCCContacts(env, listId = null) {
  // CC uses OAuth2 — we store the access token in env
  const token = env.CC_ACCESS_TOKEN;
  if (!token) throw new Error('CC_ACCESS_TOKEN not set');

  let url = 'https://api.cc.email/v3/contacts?include=list_memberships&limit=500&status=active';
  if (listId) url += `&list_id=${listId}`;

  const contacts = [];
  let nextUrl = url;

  // Handle pagination
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`CC API error: ${res.status} — ${err}`);
    }

    const data = await res.json();
    contacts.push(...(data.contacts || []));

    // Check for next page
    nextUrl = data._links?.next?.href || null;
  }

  return contacts;
}

async function getCCLists(env) {
  const token = env.CC_ACCESS_TOKEN;
  if (!token) throw new Error('CC_ACCESS_TOKEN not set');

  const res = await fetch('https://api.cc.email/v3/contact_lists?include_count=true', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) throw new Error(`CC Lists API error: ${res.status}`);
  const data = await res.json();
  return data.lists || [];
}

// ── PLANNING CENTER API ────────────────────────────────────────────────────────

async function pcoRequest(env, method, path, body = null) {
  const appId = env.PCO_APP_ID;
  const secret = env.PCO_SECRET;
  if (!appId || !secret) throw new Error('PCO credentials not set');

  const creds = btoa(`${appId}:${secret}`);
  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`https://api.planningcenteronline.com${path}`, opts);
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`PCO API error: ${res.status} — ${err}`);
  }
  return res.status === 404 ? null : await res.json();
}

async function findPCOPersonByEmail(env, email) {
  const data = await pcoRequest(env, 'GET', `/people/v2/people?where[search_name_or_email]=${encodeURIComponent(email)}&per_page=5`);
  if (!data?.data?.length) return null;
  // Find exact email match
  for (const person of data.data) {
    const emails = await pcoRequest(env, 'GET', `/people/v2/people/${person.id}/emails`);
    if (emails?.data?.some(e => e.attributes.address.toLowerCase() === email.toLowerCase())) {
      return person;
    }
  }
  return null;
}

async function createPCOPerson(env, contact, listName) {
  // Create the person
  const personBody = {
    data: {
      type: 'Person',
      attributes: {
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        status: 'active',
      }
    }
  };

  const person = await pcoRequest(env, 'POST', '/people/v2/people', personBody);
  if (!person?.data?.id) throw new Error('Failed to create PCO person');

  const personId = person.data.id;

  // Add email
  if (contact.email_address?.address) {
    await pcoRequest(env, 'POST', `/people/v2/people/${personId}/emails`, {
      data: {
        type: 'Email',
        attributes: {
          address: contact.email_address.address,
          location: 'Home',
          primary: true,
        }
      }
    });
  }

  // Add phone if available
  if (contact.phone_numbers?.length > 0) {
    const phone = contact.phone_numbers[0];
    await pcoRequest(env, 'POST', `/people/v2/people/${personId}/phone_numbers`, {
      data: {
        type: 'PhoneNumber',
        attributes: {
          number: phone.phone_number,
          location: phone.kind || 'Mobile',
          primary: true,
        }
      }
    });
  }

  // Add note with source info
  await pcoRequest(env, 'POST', `/people/v2/people/${personId}/notes`, {
    data: {
      type: 'Note',
      attributes: {
        note: `Added via Constant Contact sync. List: ${listName}. Date: ${new Date().toLocaleDateString('en-US')}`,
        note_category_id: null,
      }
    }
  });

  return personId;
}

async function addPCOTag(env, personId, tagName) {
  // Search for existing tag
  const tags = await pcoRequest(env, 'GET', `/people/v2/tags?where[name]=${encodeURIComponent(tagName)}`);

  let tagId = tags?.data?.[0]?.id;

  // Create tag if it doesn't exist
  if (!tagId) {
    const newTag = await pcoRequest(env, 'POST', '/people/v2/tags', {
      data: {
        type: 'Tag',
        attributes: { name: tagName }
      }
    });
    tagId = newTag?.data?.id;
  }

  if (!tagId) return;

  // Apply tag to person
  await pcoRequest(env, 'POST', `/people/v2/people/${personId}/tags`, {
    data: {
      type: 'Tag',
      id: tagId,
    }
  });
}

// ── SYNC LOGIC ─────────────────────────────────────────────────────────────────

async function runSync(env) {
  const results = {
    started_at: new Date().toISOString(),
    contacts_found: 0,
    created: 0,
    already_exists: 0,
    errors: 0,
    error_details: [],
    lists_synced: [],
  };

  try {
    // Get all CC lists
    const lists = await getCCLists(env);
    results.lists_synced = lists.map(l => ({ id: l.list_id, name: l.name, count: l.contact_count }));

    // Get all active CC contacts
    const contacts = await getCCContacts(env);
    results.contacts_found = contacts.length;

    for (const contact of contacts) {
      try {
        const email = contact.email_address?.address;
        if (!email) continue;

        // Determine list names for this contact
        const contactListIds = contact.list_memberships || [];
        const contactListNames = contactListIds
          .map(id => lists.find(l => l.list_id === id)?.name)
          .filter(Boolean);

        const listLabel = contactListNames.join(', ') || 'General Newsletter';

        // Check if person already exists in PCO
        const existing = await findPCOPersonByEmail(env, email);

        if (existing) {
          // Person exists — just update tags
          for (const listName of contactListNames) {
            await addPCOTag(env, existing.data.id, `CC: ${listName}`);
          }
          await addPCOTag(env, existing.data.id, 'Constant Contact Subscriber');
          results.already_exists++;
        } else {
          // Create new person in PCO
          const personId = await createPCOPerson(env, contact, listLabel);

          // Tag them
          for (const listName of contactListNames) {
            await addPCOTag(env, personId, `CC: ${listName}`);
          }
          await addPCOTag(env, personId, 'Constant Contact Subscriber');
          await addPCOTag(env, personId, 'Website Signup');

          results.created++;
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 150));

      } catch (contactErr) {
        results.errors++;
        results.error_details.push({
          email: contact.email_address?.address || 'unknown',
          error: contactErr.message
        });
      }
    }
  } catch (err) {
    results.errors++;
    results.error_details.push({ error: err.message });
  }

  results.completed_at = new Date().toISOString();
  return results;
}

// ── MAIN WORKER ────────────────────────────────────────────────────────────────

export default {
  // Runs on schedule (cron trigger)
  async scheduled(event, env, ctx) {
    console.log('Running scheduled CC → PCO sync');
    const results = await runSync(env);
    console.log('Sync complete:', JSON.stringify(results));
  },

  // Also handles HTTP requests for manual triggers and status
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Health check
    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'tab-cc-to-pco-sync',
        cc_configured: !!env.CC_ACCESS_TOKEN,
        pco_configured: !!(env.PCO_APP_ID && env.PCO_SECRET),
      });
    }

    // Manual sync trigger
    if (url.pathname === '/sync' && method === 'GET') {
      const authHeader = request.headers.get('Authorization') || '';
      const syncToken = env.SYNC_TOKEN || 'tab-sync-2026';
      if (authHeader !== `Bearer ${syncToken}`) {
        return json({ error: 'Unauthorized' }, 401);
      }

      try {
        const results = await runSync(env);
        return json({ ok: true, results });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Status / last sync info
    if (url.pathname === '/status') {
      return json({
        ok: true,
        service: 'tab-cc-to-pco-sync',
        description: 'Syncs Constant Contact subscribers into Planning Center Online',
        schedule: 'Runs every hour via Cloudflare Cron Trigger',
        manual_trigger: 'GET /sync with Authorization: Bearer <SYNC_TOKEN>',
        endpoints: ['/health', '/sync', '/status'],
      });
    }

    return json({ error: 'Not found' }, 404);
  }
};
