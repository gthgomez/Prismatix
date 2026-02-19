# Prismatix

Intelligent multi-provider model router with streaming support and React frontend.

## Project Structure

```
prismatix-frontend/  → React + Vite + TypeScript frontend
supabase/               → Edge Functions backend
SQL/                    → Database schemas
Tests/                  → Test suites
```

## Quick Start

### Frontend Development

```bash
cd prismatix-frontend
npm install
npm run dev
```

### Environment Variables

Create `prismatix-frontend/.env`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ROUTER_ENDPOINT=your_router_endpoint
```

## Deployment

### Vercel (Frontend)

```bash
vercel --prod
```

### Supabase (Backend)

```bash
supabase functions deploy
```

## Features

- 🧠 Intelligent Model Routing (Claude, GPT, Gemini)
- ⚡ Real-time Streaming Responses
- 🎨 Technical Developer UI
- 🔒 Supabase Authentication
- 📊 Complexity Visualization

## Documentation

- [Frontend Documentation](prismatix-frontend/README.md)
- [Router Context](supabase/router-stream-context.md)

## License

MIT
