const path = require('path');
const applictionPath = function (...paths) {
  return path.join(__dirname, 'application-demo', ...paths);
}
module.exports = {
  server: {
    port: 3000, // 默认监听 3000
    host: '0.0.0.0' // 监听所有网卡, 默认 localhost
  },
  localRules: [
    // 代理 /api/v1 的接口到 application/api/ 下的 json 文件, 映射规则见 filepath
    {
      path: '/api/v1/(.*)',
      filepath: (ctx) => {
        const filepath = `${ctx.method}__${ctx.path.replace(/\//g, '__')}.json`;
        return applictionPath('api', filepath);
      }
    },
    // 映射资源路径到具体文件
    {
      path: '(.*)',
      filepath: (ctx) => {
        const pathFunc =(v = 'index.html') => applictionPath('web', v);
        if (path.extname(ctx.path).length) return pathFunc(ctx.path);
        return pathFunc()
      },
    },
  ],
  // 对于所有没有匹配到映射对目录下的 index.html, 适应 SPA 应用
  historyApiFallback: applictionPath('web'),
  // 可以对部门 API 代理已有的服务上
  proxy: {
    '/api/v2': {
      target: 'https://10.48.73.210:8443',
      changeOrigin: true,
      secure: false
    }
  }
}