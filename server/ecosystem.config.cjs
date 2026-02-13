// PM2 config for CryptoPoker server (use with: pm2 start ecosystem.config.cjs --env production)
module.exports = {
  apps: [{
    name:   'cryptopoker',
    script: 'src/server.js',
    env_production: {
      NODE_ENV: 'production',
    },
    instances: 1,          // scale to 2+ with Redis session sharing
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: '/var/log/pm2/cryptopoker-error.log',
    out_file:    '/var/log/pm2/cryptopoker-out.log',
  }],
};
