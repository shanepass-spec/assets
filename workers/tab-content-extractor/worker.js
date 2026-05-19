// tab-content-extractor.js v2
// Safer D1 extractor: avoids sqlite_master and PRAGMA because Cloudflare D1 may block them.

const KNOWN_TABLES = [
  "content",
  "pages",
  "documents",
  "chunks",
  "resources",
  "knowledge",
  "settings",
  "sermons",
  "events",
  "faqs",
  "faq",
  "beliefs",
  "ministries"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        return json({
          ok: true,
          service: "tab-content-extractor",
          version: "v2",
          db: !!env.DB,
          has_admin_token: !!env.ADMIN_TOKEN
        });
      }

      if (!checkAuth(request, env)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      if (!env.DB) {
        return json({ ok: false, error: "Missing DB binding" }, 500);
      }

      if (path === "/probe") {
        return await probeTables(env);
      }

      if (path === "/table") {
        const table = url.searchParams.get("name");
        return await readTable(env, table);
      }

      if (path === "/search") {
        const q = url.searchParams.get("q") || "";
        return await searchKnownTables(env, q);
      }

      if (path === "/spanish-candidates") {
        return await spanishCandidates(env);
      }

      if (path === "/export") {
        return await exportKnownTables(env);
      }

      return json({
        ok: true,
        message: "Tab Content Extractor v2",
        endpoints: [
          "/health",
          "/probe?token=YOUR_TOKEN",
          "/table?token=YOUR_TOKEN&name=content",
          "/search?token=YOUR_TOKEN&q=salvation",
          "/spanish-candidates?token=YOUR_TOKEN",
          "/export?token=YOUR_TOKEN"
        ]
      });
    } catch (e) {
      return json({
        ok: false,
        error: e.message || String(e)
      }, 500);
    }
  }
};

function checkAuth(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

async function probeTables(env) {
  const found = [];
  const missing = [];

  for (const table of KNOWN_TABLES) {
    try {
      const count = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM "${table}"`
      ).first();

      const sample = await env.DB.prepare(
        `SELECT * FROM "${table}" LIMIT 2`
      ).all();

      found.push({
        table,
        count: count?.count ?? 0,
        sample: sample.results || []
      });
    } catch (e) {
      missing.push({
        table,
        error: e.message
      });
    }
  }

  return json({
    ok: true,
    found,
    missing
  });
}

async function readTable(env, table) {
  if (!table) {
    return json({ ok: false, error: "Missing table name" }, 400);
  }

  if (!KNOWN_TABLES.includes(table)) {
    return json({
      ok: false,
      error: "Table not allowed in v2 safety list",
      allowed_tables: KNOWN_TABLES
    }, 400);
  }

  const rows = await env.DB.prepare(
    `SELECT * FROM "${table}" LIMIT 100`
  ).all();

  return json({
    ok: true,
    table,
    rows: rows.results || []
  });
}

async function searchKnownTables(env, q) {
  if (!q.trim()) {
    return json({ ok: false, error: "Missing search query" }, 400);
  }

  const results = [];

  for (const table of KNOWN_TABLES) {
    try {
      const rows = await env.DB.prepare(
        `
        SELECT *
        FROM "${table}"
        WHERE
          CAST(id AS TEXT) LIKE ?
          OR CAST(title AS TEXT) LIKE ?
          OR CAST(name AS TEXT) LIKE ?
          OR CAST(content AS TEXT) LIKE ?
          OR CAST(body AS TEXT) LIKE ?
          OR CAST(text AS TEXT) LIKE ?
          OR CAST(description AS TEXT) LIKE ?
          OR CAST(answer AS TEXT) LIKE ?
          OR CAST(question AS TEXT) LIKE ?
        LIMIT 20
        `
      )
        .bind(
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`
        )
        .all();

      if (rows.results && rows.results.length) {
        results.push({
          table,
          rows: rows.results
        });
      }
    } catch (_) {
      // Ignore tables/columns that do not exist.
    }
  }

  return json({
    ok: true,
    query: q,
    results
  });
}

async function spanishCandidates(env) {
  const terms = [
    "spanish",
    "español",
    "espanol",
    "salvation",
    "gospel",
    "grace",
    "faith",
    "jesus",
    "christ",
    "salvación",
    "evangelio",
    "gracia",
    "fe",
    "jesús",
    "cristo",
    "statement of faith",
    "beliefs",
    "creemos",
    "doctrina",
    "sunday school",
    "kids",
    "children",
    "family",
    "familia",
    "visit",
    "welcome",
    "bienvenido"
  ];

  const output = [];

  for (const term of terms) {
    const result = await searchKnownTablesRaw(env, term);
    if (result.length) {
      output.push({
        term,
        results: result
      });
    }
  }

  return json({
    ok: true,
    purpose: "Find existing Tab Assistant content useful for Spanish source planning.",
    candidates: output
  });
}

async function searchKnownTablesRaw(env, q) {
  const results = [];

  for (const table of KNOWN_TABLES) {
    try {
      const rows = await env.DB.prepare(
        `
        SELECT *
        FROM "${table}"
        WHERE
          CAST(id AS TEXT) LIKE ?
          OR CAST(title AS TEXT) LIKE ?
          OR CAST(name AS TEXT) LIKE ?
          OR CAST(content AS TEXT) LIKE ?
          OR CAST(body AS TEXT) LIKE ?
          OR CAST(text AS TEXT) LIKE ?
          OR CAST(description AS TEXT) LIKE ?
          OR CAST(answer AS TEXT) LIKE ?
          OR CAST(question AS TEXT) LIKE ?
        LIMIT 10
        `
      )
        .bind(
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`
        )
        .all();

      if (rows.results && rows.results.length) {
        results.push({
          table,
          rows: rows.results
        });
      }
    } catch (_) {}
  }

  return results;
}

async function exportKnownTables(env) {
  let md = "# Tab Assistant Known Table Export\n\n";
  md += `Exported: ${new Date().toISOString()}\n\n`;

  const found = [];

  for (const table of KNOWN_TABLES) {
    try {
      const rows = await env.DB.prepare(
        `SELECT * FROM "${table}" LIMIT 500`
      ).all();

      const data = rows.results || [];

      found.push({
        table,
        count: data.length
      });

      md += `---\n\n## ${table}\n\n`;
      md += `Rows exported: ${data.length}\n\n`;

      data.forEach((row, index) => {
        md += `### Row ${index + 1}\n\n`;
        for (const [key, value] of Object.entries(row)) {
          md += `**${key}:** ${value ?? ""}\n\n`;
        }
      });
    } catch (_) {}
  }

  md += "\n---\n\n## Export Summary\n\n";
  found.forEach(item => {
    md += `- ${item.table}: ${item.count} rows\n`;
  });

  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8"
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
