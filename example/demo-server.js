const Koa = require('koa');
const koaBody = require('koa-body');
const app = new Koa();
app.use(koaBody());

const routes = [
  {
    path: (req) => req.path.startsWith('/api'),
    response: ({req, headers}) => {
      return `api, ${req.path}`
    }
  },
  {
    path: (req) => req.path.startsWith('/mock'),
    response: ({req, headers}) => {
      return `mock, ${req.path}`
    }
  },
];

routes.forEach(route => {
  app.use((ctx, next) => {
    if (route.path(ctx.request)) {
      ctx.body = route.response({req: ctx.request, headers: ctx.headers});
      return
    }
    next();
  });
})

app.use((ctx, next) => {
  ctx.body = `I'm a demo server, you can try /api or /mock`;
});

const port = 3001;
app.listen(port, async (err) => {
  if (err) throw err
  console.log(`You can visit http://localhost:${port}`)
});