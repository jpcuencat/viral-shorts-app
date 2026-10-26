This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Docker (prueba local fuera del entorno de desarrollo)

Requiere Docker Desktop. Desde la carpeta del proyecto:

```bash
docker compose --env-file .env.local up --build -d
```

- La app queda en http://localhost:3100 (el entorno de desarrollo sigue en el 3000).
- Antes de usarla, detén `npm run dev:all`: el contenedor trae su propio worker de reels y los dos tomarían los mismos trabajos.
- n8n se alcanza desde el contenedor por `host.docker.internal` (variable `N8N_LOCALHOST_ALIAS`).
- Los reels, el vault y los archivos subidos quedan en volúmenes de Docker (`docker compose down` los conserva; `down -v` los borra).
- Logs: `docker compose logs -f app`.
