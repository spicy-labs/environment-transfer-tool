import { transferItems, type ResourceName } from "./transfer";
import ChiliConnectorV1_1 from "@seancrowe/chiliconnector-v1_1";
import { join } from "path";

const PORT = 3000;
const FRONTEND_DIR = join(import.meta.dir, "frontend");

// Store active connections keyed by a session concept (source/dest)
const connections: Map<
  string,
  {
    base: string;
    env: string;
    connector: ChiliConnectorV1_1;
    newConnector: () => Promise<ChiliConnectorV1_1>;
  }
> = new Map();

function parseChiliPublishURL(url: string) {
  try {
    const parsedUrl = new URL(url);
    const base = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    const env = parsedUrl.hostname.split(".")[0];
    return { base, env };
  } catch (e: any) {
    throw new Error("Invalid URL: " + e.message);
  }
}

async function connectToChili(url: string, apiKey: string) {
  const { base, env } = parseChiliPublishURL(url);

  const newConnector = async () => {
    const connector = new ChiliConnectorV1_1(base);
    connector.apiKey = apiKey;
    return connector;
  };

  // Test the connection by making a simple API call
  const connector = await newConnector();
  const resp = await connector.api.resourceGetTreeLevel({
    resourceName: "Documents",
    parentFolder: "",
    numLevels: 1,
  });

  if (!resp.ok) {
    throw new Error(
      `Failed to connect to ${base}. Status: ${resp.status}. Check your URL and API key.`,
    );
  }

  return { base, env, connector, newConnector };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

// SSE connections for transfer progress
let transferSSEController: ReadableStreamDefaultController<Uint8Array> | null =
  null;

function sendSSE(
  event: string,
  data: Record<string, unknown>,
) {
  if (transferSSEController) {
    try {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      transferSSEController.enqueue(new TextEncoder().encode(msg));
    } catch {
      // Controller closed
    }
  }
}

// Override console.log during transfers to capture output
const originalLog = console.log;
const originalError = console.error;

function patchConsoleForTransfer() {
  console.log = (...args: unknown[]) => {
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    // Strip ANSI codes for the SSE message
    const clean = message.replace(
      /\x1b\[[0-9;]*m/g,
      "",
    );
    sendSSE("log", { message: clean });
    originalLog(...args);
  };
  console.error = (...args: unknown[]) => {
    const message = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    const clean = message.replace(
      /\x1b\[[0-9;]*m/g,
      "",
    );
    sendSSE("error", { message: clean });
    originalError(...args);
  };
}

function restoreConsole() {
  console.log = originalLog;
  console.error = originalError;
}

async function handleAPI(req: Request, pathname: string): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    if (pathname === "/api/connect" && req.method === "POST") {
      const body = (await req.json()) as {
        url: string;
        apiKey: string;
        role: string;
      };
      const { url, apiKey, role } = body;

      if (!url || !apiKey || !role) {
        return new Response(
          JSON.stringify({ error: "Missing url, apiKey, or role" }),
          { status: 400, headers },
        );
      }

      const conn = await connectToChili(url, apiKey);
      connections.set(role, conn);

      return new Response(
        JSON.stringify({
          success: true,
          base: conn.base,
          env: conn.env,
        }),
        { headers },
      );
    }

    if (pathname === "/api/browse" && req.method === "POST") {
      const body = (await req.json()) as {
        role: string;
        resource: string;
        path: string;
      };
      const { role, resource, path } = body;

      const conn = connections.get(role);
      if (!conn) {
        return new Response(
          JSON.stringify({ error: "Not connected. Please connect first." }),
          { status: 400, headers },
        );
      }

      const connector = await conn.newConnector();
      const resp = await connector.api.resourceGetTreeLevel({
        resourceName: resource as any,
        parentFolder: path || "",
        numLevels: 1,
      });

      if (!resp.ok) {
        return new Response(
          JSON.stringify({
            error: `Failed to browse ${resource} at path "${path}". Status: ${resp.status}`,
          }),
          { status: 500, headers },
        );
      }

      const text = await resp.text();

      // Parse the XML tree response into a usable structure
      const items = parseTreeXML(text);

      return new Response(JSON.stringify({ items }), { headers });
    }

    if (pathname === "/api/transfer/events" && req.method === "GET") {
      // SSE endpoint for transfer progress
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          transferSSEController = controller;
          // Send initial connection message
          const msg = `event: connected\ndata: ${JSON.stringify({ message: "Connected to transfer events" })}\n\n`;
          controller.enqueue(new TextEncoder().encode(msg));
        },
        cancel() {
          transferSSEController = null;
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (pathname === "/api/transfer" && req.method === "POST") {
      const body = (await req.json()) as {
        resource: string;
        items: { id: string; name: string }[];
      };
      const { resource, items } = body;

      const srcConn = connections.get("source");
      const destConn = connections.get("destination");

      if (!srcConn || !destConn) {
        return new Response(
          JSON.stringify({
            error: "Both source and destination must be connected",
          }),
          { status: 400, headers },
        );
      }

      const itemIds = items.map((i) => i.id);

      sendSSE("start", {
        message: `Starting transfer of ${items.length} ${resource}...`,
        total: items.length,
      });

      // Run transfer in background
      (async () => {
        patchConsoleForTransfer();
        try {
          await transferItems({
            dest: {
              base: destConn.base,
              env: destConn.env,
              newConnector: destConn.newConnector,
            },
            src: {
              base: srcConn.base,
              env: srcConn.env,
              newConnector: srcConn.newConnector,
            },
            resource: resource as ResourceName,
            items: itemIds,
          });

          sendSSE("complete", { message: "Transfer completed!" });
        } catch (e: any) {
          sendSSE("error", {
            message: `Transfer failed: ${e.message || String(e)}`,
          });
        } finally {
          restoreConsole();
        }
      })();

      return new Response(
        JSON.stringify({ success: true, message: "Transfer started" }),
        { headers },
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers,
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message || String(e) }),
      { status: 500, headers },
    );
  }
}

function parseTreeXML(xml: string): Array<{
  name: string;
  id: string;
  isFolder: boolean;
  path: string;
}> {
  const items: Array<{
    name: string;
    id: string;
    isFolder: boolean;
    path: string;
  }> = [];

  // Parse XML items - the CHILI API returns XML like:
  // <tree><item name="..." id="..." isFolder="true" path="..."/></tree>
  const itemRegex =
    /<item\s+[^>]*?(?:name="([^"]*)"[^>]*?id="([^"]*)"[^>]*?isFolder="([^"]*)"[^>]*?(?:path="([^"]*)")?|id="([^"]*)"[^>]*?name="([^"]*)"[^>]*?isFolder="([^"]*)"[^>]*?(?:path="([^"]*)")?)[^>]*?\/?>/g;

  // More robust approach - extract attributes individually from each item tag
  const tagRegex = /<item\s([^>]*?)\/?\s*>/g;
  let tagMatch;

  while ((tagMatch = tagRegex.exec(xml)) !== null) {
    const attrs = tagMatch[1];
    const name = extractAttr(attrs, "name") || "";
    const id = extractAttr(attrs, "id") || "";
    const isFolder = extractAttr(attrs, "isFolder") === "true";
    const path = extractAttr(attrs, "path") || extractAttr(attrs, "relativePath") || "";

    if (name || id) {
      items.push({ name, id, isFolder, path });
    }
  }

  return items;
}

function extractAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`${name}="([^"]*)"`, "i");
  const match = regex.exec(attrs);
  return match ? match[1] : null;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith("/api/")) {
      return handleAPI(req, pathname);
    }

    // Static file serving
    let filePath = pathname === "/" ? "/index.html" : pathname;
    const fullPath = join(FRONTEND_DIR, filePath);

    // Security: prevent directory traversal
    if (!fullPath.startsWith(FRONTEND_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(fullPath);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": getMimeType(fullPath) },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT}`);
