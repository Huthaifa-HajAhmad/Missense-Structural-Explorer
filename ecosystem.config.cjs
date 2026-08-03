module.exports = {
  apps: [
    {
      name: "missense-fold",
      script: "dist/server.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1G",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      error_file: "logs/pm2-err.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
