/**
 * Alert Webhook Forwarder Server
 * 
 * This endpoint receives alerts from the client and forwards them to Discord/Telegram/Email
 * webhooks. This avoids CORS issues when calling webhooks directly from the browser.
 */

import { createServer } from "http";

const PORT = process.env.PORT || 3100;

// In-memory store for alert configuration (in production, use Redis or database)
const alertConfigs = new Map<string, any>();

// Helper to send Discord webhook
async function sendDiscord(url: string, payload: any): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (error) {
    console.error("Discord webhook error:", error);
    return false;
  }
}

// Helper to send Telegram message
async function sendTelegram(botApiUrl: string, chatId: string, text: string): Promise<boolean> {
  if (!botApiUrl || !chatId) return false;
  try {
    const response = await fetch(botApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return false;
  }
}

// Helper to send email webhook (custom backend)
async function sendEmail(url: string, subject: string, message: string): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, message }),
    });
    return response.ok;
  } catch (error) {
    console.error("Email webhook error:", error);
    return false;
  }
}

// Format alert message
function formatAlertMessage(evt: any): string {
  const severity = (evt.severity || "info").toUpperCase();
  const ts = new Date(evt.ts || Date.now()).toISOString();
  
  let header = `[ForgeOS][${severity}] ${evt.title}`;
  if (evt.repeatCount && evt.repeatCount > 1) {
    header += ` (${evt.repeatCount}x)`;
  }
  
  let body = evt.message || "";
  if (evt.meta) {
    const metaLines: string[] = [];
    for (const [k, v] of Object.entries(evt.meta)) {
      if (v !== undefined && v !== null) {
        metaLines.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
    if (metaLines.length > 0) {
      body += "\n" + metaLines.join(" | ");
    }
  }
  
  return `${header}\n${body}\n${ts}`.slice(0, 1200);
}

// HTTP request handler
async function handleRequest(req: any, res: any) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "alert-forwarder" }));
    return;
  }

  // Alert endpoint
  if (req.url === "/v1/alerts" && req.method === "POST") {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      
      const alert = JSON.parse(body);
      
      if (!alert.scope) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "scope is required" }));
        return;
      }

      // Get config for this scope (from query param or header)
      const scope = alert.scope;
      const config = alertConfigs.get(scope) || alert.config;
      
      if (!config) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no configuration found for scope" }));
        return;
      }

      // Check if alerts are enabled
      if (!config.enabled) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sent: false, reason: "disabled" }));
        return;
      }

      // Check if this alert type is enabled
      if (config.eventToggles && !config.eventToggles[alert.type]) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sent: false, reason: "event_disabled" }));
        return;
      }

      // Check if any webhook is configured
      const hasRoute = config.discordWebhookUrl || 
                      (config.telegramBotApiUrl && config.telegramChatId) || 
                      config.emailWebhookUrl;
      
      if (!hasRoute) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sent: false, reason: "no_routes_configured" }));
        return;
      }

      const failures: string[] = [];
      let sentCount = 0;
      const message = formatAlertMessage(alert);

      // Send to Discord
      if (config.discordWebhookUrl) {
        try {
          const success = await sendDiscord(config.discordWebhookUrl, { content: message });
          if (success) sentCount++;
          else failures.push("discord:failed");
        } catch (e: any) {
          failures.push(`discord:${e.message || "error"}`);
        }
      }

      // Send to Telegram
      if (config.telegramBotApiUrl && config.telegramChatId) {
        try {
          const success = await sendTelegram(config.telegramBotApiUrl, config.telegramChatId, message);
          if (success) sentCount++;
          else failures.push("telegram:failed");
        } catch (e: any) {
          failures.push(`telegram:${e.message || "error"}`);
        }
      }

      // Send to Email webhook
      if (config.emailWebhookUrl) {
        try {
          const success = await sendEmail(config.emailWebhookUrl, `[ForgeOS] ${alert.title}`, message);
          if (success) sentCount++;
          else failures.push("email:failed");
        } catch (e: any) {
          failures.push(`email:${e.message || "error"}`);
        }
      }

      if (sentCount === 0 && failures.length) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sent: false, reason: "delivery_failed", failures }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sent: sentCount > 0, sentCount, failures: failures.length ? failures : undefined }));
      
    } catch (error: any) {
      console.error("Alert error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message || "internal_error" }));
    }
    return;
  }

  // Config endpoint - allows client to save config to server
  if (req.url === "/v1/alerts/config" && req.method === "POST") {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      
      const { scope, config } = JSON.parse(body);
      
      if (!scope || !config) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "scope and config are required" }));
        return;
      }

      alertConfigs.set(scope, config);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ saved: true }));
      
    } catch (error: any) {
      console.error("Config save error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message || "internal_error" }));
    }
    return;
  }

  // Config endpoint - get config for scope
  if (req.url?.startsWith("/v1/alerts/config/") && req.method === "GET") {
    const scope = req.url.split("/v1/alerts/config/")[1];
    const config = alertConfigs.get(scope);
    
    if (config) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    }
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}

// Create and start server
const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Alert webhook forwarder running on port ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  POST /v1/alerts - Send alert`);
  console.log(`  POST /v1/alerts/config - Save config`);
  console.log(`  GET /v1/alerts/config/:scope - Get config`);
});

export { server };

