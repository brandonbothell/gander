# <img src="https://gander.brandonsbench.net/ic_launcher_round.png" width="48" alt="Gander Icon"> Gander

A security camera application.

## Table of Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Starting the Server](#starting-the-server)
- [Nginx Configuration](#nginx-configuration)
- [Working With Android](#working-with-android)

## Requirements

- Node.js v22+ (install via `nvm`, [install yarn with `corepack`](https://yarnpkg.com/getting-started/install)) (Latest tested: **v26.13.1**)
- ffmpeg v7+ (Latest tested: **v8.1**)
- _Production_:
  - A reverse proxy like nginx to handle HTTPS (see [configuration](#nginx-configuration))

## Quick Start

1. Configure files: Rename [`config.example.json`](./config.example.json), [`greenlock.d/config.example.json`](./greenlock.d/config.example.json), and [`.env.example`](./.env.example) by removing "`.example`" from the filenames.
   - Fill in `config.json`, `greenlock.d/config.json`, and `.env` by reading comments and property names in the config/this README to know how to fill the values.

2. Run `yarn db:generate` and `yarn db:migrate:deploy` to set up the database.
   - At this point your should be able to run `yarn dev` to test in a development environment.

3. Generate SSL certificates: `yarn generate:ssl`.

4. Build and start: `yarn build && yarn start`.

5. Access via your reverse-proxy (see [nginx config](#nginx-configuration))
   - Serve the SSL certificates from `greenlock.d/live/YourWebsite.com/`

## Detailed Setup

1. **Configuration Files**: Rename the following example configuration files, replacing placeholders with your real values:

   | Original file                                                          | New file                    |
   | ---------------------------------------------------------------------- | --------------------------- |
   | [`.env.example`](./.env.example)                                       | `.env`                      |
   | [`config.example.json`](./config.example.json)                         | `config.json`               |
   | [`greenlock.d/config.example.json`](./greenlock.d/config.example.json) | `greenlock.d/config.json`\* |

   <sup>_\*If you don't already have SSL certificates, plan to use `greenlock.d/config.json`. Otherwise, you can leave it as is if you don't plan to use `yarn generate:ssl`._</sup>

2. **Database**: Run `yarn db:generate` to initialize the database manager and `yarn db:migrate:deploy` to set up the database tables.

3. **SSL Certificates**: Use `yarn generate:ssl` to generate SSL (HTTPS) certificates **after** editing `greenlock.d/config.json` with greenlock-express.
   - This starts an ACME authentication server on ports 80/443 and terminates automatically after certificate renewal or a 40-second timeout.
   - If you wish, you can instead use your own SSL certificates with your reverse-proxy (nginx) by pointing nginx to wherever those are located on your system.

4. **Build**: Run `yarn build` to compile the server and client.

5. **Reverse Proxy**: Configure nginx or a similar reverse-proxy to proxy to `http://localhost:3000` (port 3000 is Gander's default), using the SSL certificates generated in `greenlock.d/live/` (or your own).

## Starting the Server

- Production
  - Ensure `API_ENV` and `ANDROID_ENV` are set to `production` in [`.env`](./.env.example).
  - Run `yarn build` and then `yarn start`. Ensure ports 80 and 443 are available for the reverse proxy. Access your site through the proxy.

- Development/Testing:
  - Ensure `API_ENV` and `ANDROID_ENV` are set to `development` in [`.env`](./.env.example).
  - Run `yarn build` and then `yarn start`. Ensure port `3000` (default dev port, change by adding `PORT` to [`.env`](./.env.example)) is available for the server. The site should open by itself. If not, open [localhost:3000](http://localhost:3000) in a browser.

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

## Working With Android

To provide the most secure application possible, the Android app is integrated with the Firebase App Check Play Integrity API. A [Google Play Console](https://play.google.com/console/developers) developer account ($25 one-time fee) is required for this to function, but you can remove the functionality from the app if you so please, _noting that it increases the impact of XSS attacks_.

1. [**Click here**](https://firebase.google.com/docs/android/setup#create-firebase-project) to learn how to setup a Firebase project
   - When prompted for a package name, enter `net.strangled.dutta.securitycam`
   - **_Important Note:_** Stop at **step 3.1** - you should have just downloaded a `google-services.json` file.

2. Place a copy of the downloaded `google-services.json` in both the project root (`./`) and [`./android/app/`](./android/app)

3. Then, follow [**these steps**](https://firebase.google.com/docs/app-check/android/play-integrity-provider#project-setup) to enable the Play Integrity API.

4. Set up the advanced [**AppCheck settings**](https://console.firebase.google.com/project/_/appcheck/apps) of the app you made while following step 3.
   - If you aren't distributing on Play Store (likely), then you'll want to ignore `PLAY_RECOGNIZED` and `LICENSED` while requiring `MEETS_DEVICE_INTEGRITY`.

5. Navigate to your project's [**Firebase service accounts**](https://console.firebase.google.com/u/0/project/_/settings/serviceaccounts) and click **"Generate a new private key"**. Download the JSON file, rename it to `security-cam-credentials.json`, and place it in the project root.

6. Build the Android app in `production` environment when generating a release APK, but when coding locally, use `development` env to make the app work properly in the Android Studio emulator.
   - Always run `yarn cap sync` after any changes to [`.env`](./.env.example).
   - Run `yarn cap open android` to open the project in [Android Studio](https://developer.android.com/studio) automatically.
