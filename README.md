# Gander

A security camera application.

## Quick Start

1. Configure files: Copy `config.example.json`, `web/config.example.json`, `greenlock.d/config.example.json`, and `.env.example` to their respective `.json` and `.env` files, replacing placeholders.
2. Run `yarn db:generate` to set up the database.
3. Generate SSL certificates: `yarn generate:ssl`.
4. Build and start: `yarn build && yarn start`.
5. Access via your reverse-proxy (see [nginx config](#nginx-configuration))
    - Serve the SSL certificates from `greenlock.d/live/YourWebsite.com/`

## Prerequisites

- Node.js v20+ (install via `nvm`, enable yarn with `corepack`). Latest tested: v25.2.1
- ffmpeg v7+ (tested with v7.1.2)
- A reverse proxy like nginx to handle HTTPS (see [configuration](#nginx-configuration))

## Detailed Setup

1. **Configuration Files**: Rename the following example configuration files, replacing placeholders with your real values:
  - `.env`
   - `config.json`
   - `web/config.json`
   - `greenlock.d/config.json` (if you don't have SSL certificates already)

2. **Database**: Run `yarn db:generate` to initialize the database manager.

3. **SSL Certificates**: Use `yarn generate:ssl` to generate SSL (HTTPS) certificates **after** editing `greenlock.d/config.json` with greenlock-express.
    - This starts an ACME authentication server on ports 80/443 and terminates automatically after certificate renewal or a 40-second timeout.
    - If you wish, you can instead use your own SSL certificates with your reverse-proxy (nginx) by pointing nginx to wherever those are located on your system.

4. **Build**: Run `yarn build` to compile the server and client.

5. **Reverse Proxy**: Configure nginx or a similar reverse-proxy to proxy to `http://localhost:3000` (port 3000 is Gander's default), using the SSL certificates generated in `greenlock.d/live/` (or your own).

## Starting the Server

Run `yarn build` and then `yarn start`. Ensure ports 80 and 443 are available for the reverse proxy. Access your site through the proxy.

## Nginx Configuration

```properties
# Gander HTTPS server configuration

 # Redirect HTTP to HTTPS
server {
  listen 80;
  listen [::]:80;
  # Change example.tld to your website's address (like example.com)
  server_name example.tld;
  return 301 https://$host$request_uri;
}

# HTTPS
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  # Change example.tld to your website's address (like example.com)
  server_name example.tld;

  # CHANGE these paths to include YOUR website's domain, NOT "example.tld"
  ssl_certificate /path/to/gander/greenlock.d/live/example.tld/fullchain.pem;
  ssl_certificate_key /path/to/gander/greenlock.d/live/example.tld/privkey.pem;
  ssl_trusted_certificate /path/to/gander/greenlock.d/live/example.tld/fullchain.pem;
  add_header Strict-Transport-Security "max-age=31536000;";

  location / {
    # You may have changed the port from the default of 3000 in config.json
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # If you use Cloudflare proxying, replace $remote_addr with $http_cf_connecting_ip
    # See https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/#nginx-1
    # alternatively use ngx_http_realip_module
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  error_page 500 502 503 504 /50x.html;
  location = /50x.html {
    root /usr/share/nginx/html;
  }
}
```
