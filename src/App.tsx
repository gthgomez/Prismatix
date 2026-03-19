import React from 'react';
import { CONFIG } from './config';
import './styles/app.css';

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-pill">
      <span className="status-pill-label">{label}</span>
      <span className="status-pill-value">{value}</span>
    </div>
  );
}

function App() {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Public Release</p>
        <h1>{CONFIG.appName}</h1>
        <p className="lead">
          A lightweight public starter for teams that want a clean React shell
          connected to their own backend and deployment flow.
        </p>
        <div className="status-grid">
          <StatusPill
            label="API endpoint"
            value={CONFIG.apiUrl ? 'configured' : 'set VITE_API_URL'}
          />
          <StatusPill label="Private backend" value="required externally" />
          <StatusPill label="Public repo scope" value="frontend starter only" />
        </div>
      </section>

      <section className="content-grid">
        <article className="info-card">
          <h2>What is included</h2>
          <ul>
            <li>Vite + React + TypeScript app shell</li>
            <li>Safe environment template</li>
            <li>Static assets and deployment-ready config</li>
            <li>Documentation for connecting your own backend</li>
          </ul>
        </article>

        <article className="info-card">
          <h2>How to extend it</h2>
          <ul>
            <li>Swap in your own API endpoint</li>
            <li>Add authentication or session handling as needed</li>
            <li>Replace starter copy, styling, and assets</li>
            <li>Grow the app without inheriting private implementation details</li>
          </ul>
        </article>
      </section>

      <section className="integration-card">
        <h2>Environment</h2>
        <pre>{`VITE_API_URL=${CONFIG.apiUrl || 'https://YOUR_API_URL'}`}</pre>
        <p>
          Point <code>VITE_API_URL</code> at your own authenticated backend.
        </p>
      </section>
    </main>
  );
}

export default App;
