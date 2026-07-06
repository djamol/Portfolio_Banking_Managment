module.exports = {
    apps: [
      {
        name: "angular-frontend",
        script: "http-server",
        args: "./dist/portfolio-frontend/browser -p 4200",
        shell: true,
        instances: "1",
        exec_mode: "fork",
        watch: false,
        env: {
          NODE_ENV: "production"
        }
      }
    ]
  };
  