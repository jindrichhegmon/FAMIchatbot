// pm2: pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'fami-chatbot',
      script: 'server.js',
      cwd: '/opt/fami-chatbot',
      instances: 1, // sessions jsou in-memory → 1 instance (nebo sticky sessions)
      env: { NODE_ENV: 'production', PORT: 3010 },
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
