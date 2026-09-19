// pm2: все сервисы монорепозитория.  npm start  |  pm2 start ecosystem.config.js
const path = require("path");
const ROOT = __dirname;
const env = { BIBLIOTOOL_ROOT: ROOT, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" };

module.exports = {
  apps: [
    {
      name: "bibliotool-api",
      cwd: ROOT,
      script: "python",
      args: "-m uvicorn apps.api.main:app --host 0.0.0.0 --port 8000",
      interpreter: "none",
      env,
      max_restarts: 10,
      out_file: path.join(ROOT, "data", "logs", "api.out.log"),
      error_file: path.join(ROOT, "data", "logs", "api.err.log"),
    },
    {
      name: "bibliotool-web",
      cwd: path.join(ROOT, "apps", "web"),
      script: require.resolve("next/dist/bin/next"),
      args: "start -p 3000",
      interpreter: "node",
      env: { ...env, API_URL: "http://127.0.0.1:8000", NODE_ENV: "production" },
      out_file: path.join(ROOT, "data", "logs", "web.out.log"),
      error_file: path.join(ROOT, "data", "logs", "web.err.log"),
    },
    {
      name: "bibliotool-streamlit",
      cwd: ROOT,
      script: "python",
      args: "-m streamlit run apps/streamlit/streamlit_app.py --server.port 8501 --server.headless true --browser.gatherUsageStats false",
      interpreter: "none",
      env,
      out_file: path.join(ROOT, "data", "logs", "streamlit.out.log"),
      error_file: path.join(ROOT, "data", "logs", "streamlit.err.log"),
    },
  ],
};
