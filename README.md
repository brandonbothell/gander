# Gander

A security camera application.

## Quick Start

1. Configure files: Copy `config.example.json`, `web/config.example.json`, `greenlock.d/config.example.json`, and `.env.example` to their respective `.json` and `.env` files, replacing placeholders.
2. Run `yarn db:generate` to set up the database.
3. Generate SSL certificates: `yarn generate:ssl`.
4. Build and start: `yarn build && yarn start`.
5. Access via your reverse proxy (see [nginx config](#nginx-configuration)).

## Prerequisites

- Node.js v20+ (install via `nvm`, enable yarn with `corepack`). Latest tested: v25.2.1
- ffmpeg v7+ (tested with v7.1.2)
- A reverse proxy like nginx to handle HTTPS (see [configuration](#nginx-configuration))

## Detailed Setup

1. **Configuration Files**: Rename the example config files, replacing placeholders with your real values. Required config files:
   - `config.json`
   - `web/config.json`
   - `greenlock.d/config.json`
   - `.env`

2. **Database**: Run `yarn db:generate` to initialize Prisma.

3. **SSL Certificates**: Use `yarn generate:ssl` to generate certificates with greenlock-express. This starts the server on ports 80/443 and terminates automatically after certificate renewal or a 40-second timeout.

4. **Build**: Run `yarn build` to compile the server and client.

5. **Reverse Proxy**: Configure nginx or similar to proxy to `http://localhost:3000` (default port), using the generated SSL certificates.

## Starting the Server

Run `yarn start` after building. Ensure ports 80 and 443 are available for the reverse proxy. Access your site through the proxy.

## Nginx Configuration

```conf
# Gander HTTPS server configuration
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name example.tld;

  ssl_certificate /path/to/gander/greenlock.d/live/example.tld/fullchain.pem;
  ssl_certificate_key /path/to/gander/greenlock.d/live/example.tld/privkey.pem;
  ssl_trusted_certificate /path/to/gander/greenlock.d/live/example.tld/fullchain.pem;
  add_header Strict-Transport-Security "max-age=31536000;";

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # If you use Cloudflare proxying, replace $remote_addr with $http_cf_connecting_ip
    # See https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/#nginx-1
    # alternatively use ngx_http_realip_module
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  error_page 500 502 503 504 /50x.html;
  location = /50x.html {
    root /usr/share/nginx/html;
  }
}
```
