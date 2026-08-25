services:
  - type: web
    name: portal-observatorio-ersep-boletin
    runtime: python
    rootDir: backend
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /api/health
    envVars:
      - key: FRONTEND_ORIGINS
        value: https://ersep-innova.github.io,https://ersepobservatorio-cyt.github.io

      - key: SCRAPER_HTTP_TIMEOUT
        value: 45

  - type: web
    name: portal-observatorio-ersep-permisos
    runtime: python
    rootDir: backend-permisos
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /api/health

    envVars:
      # PostgreSQL
      - key: DATABASE_URL
        fromDatabase:
          name: ersep-permisos-db
          property: connectionString

      # Frontend autorizado
      - key: FRONTEND_ORIGINS
        value: https://ersep-innova.github.io,https://ersepobservatorio-cyt.github.io

      # Acceso local simple (sin Google Login)
      - key: BOOTSTRAP_ADMIN_USERNAME
        value: admin

      - key: BOOTSTRAP_ADMIN_PASSWORD
        sync: false

      - key: BOOTSTRAP_ADMIN_EMAIL
        sync: false

      - key: AUTH_SESSION_HOURS
        value: "12"

      # OAuth queda sólo para la integración opcional con Google Sheets
      - key: GOOGLE_OAUTH_CLIENT_ID
        sync: false

      # Google Sheets
      - key: GOOGLE_SHEET_ID
        sync: false

      - key: GOOGLE_OAUTH_CLIENT_SECRET
        sync: false

      - key: GOOGLE_SHEETS_REDIRECT_URI
        value: https://portal-observatorio-ersep-permisos.onrender.com/api/google-sheets/callback

      - key: PERMISOS_FRONTEND_URL
        value: https://ersep-innova.github.io/portal/modulos/permisos-salida/

      - key: SHEETS_ENABLED
        value: "false"

      # Permite aceptar los scopes adicionales que Google devuelve
      - key: OAUTHLIB_RELAX_TOKEN_SCOPE
        value: "1"

      # Notificaciones por email. Gmail SMTP no requiere OAuth del usuario.
      - key: EMAIL_ENABLED
        value: "false"

      - key: EMAIL_PROVIDER
        value: gmail_smtp

      - key: EMAIL_FROM
        sync: false

      - key: SMTP_HOST
        value: smtp.gmail.com

      - key: SMTP_PORT
        value: "465"

      - key: SMTP_SSL
        value: "true"

      - key: SMTP_USER
        sync: false

      - key: SMTP_PASSWORD
        sync: false

      # Alternativa opcional: cambiar EMAIL_PROVIDER a resend y configurar esta clave.
      - key: RESEND_API_KEY
        sync: false


databases:
  - name: ersep-permisos-db
    plan: free
    databaseName: ersep_permisos
    user: ersep_permisos_app
    ipAllowList: []
