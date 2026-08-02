// deploy/ecosystem.config.cjs — PM2 集群模式部署（Phase 0）
// 用法：pm2 start deploy/ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: 'ai-image-studio',
      script: 'server/server.js',
      // 集群模式：每个 CPU 一个进程，共享 3001 端口（Node 原生 cluster 负载均衡）
      instances: 'max',
      exec_mode: 'cluster',
      // 单进程内存超 1G 自动重启，避免内存泄漏拖垮整机
      max_memory_restart: '1G',
      // 优雅重启：旧进程处理完在途请求再退出
      listen_timeout: 10000,
      kill_timeout: 5000,
      exp_backoff_restart_delay: 100,
      // 生产环境环境变量
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // 日志
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      // 关键：把未捕获异常写日志而非静默退出
      ignore_watch: ['node_modules', 'dist', 'server/data'],
    },
  ],
};
