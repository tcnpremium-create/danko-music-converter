// Componentes de presentación reutilizables.
import React from 'react';
import type { JobStatus, DashboardStats } from '../types/index.js';
import { fmtBytes, fmtEta } from '../renderer/store.js';

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge b-${status}`}>{status}</span>;
}

export function ProgressBar({ value, big }: { value: number; big?: boolean }) {
  return (
    <div className={`progress ${big ? 'bigbar' : ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function StatCard({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className={`card stat ${tone ?? ''}`}>
      <div className="k">{k}</div>
      <div className="v mono">{v}</div>
    </div>
  );
}

export function Dashboard({ stats, running }: { stats: DashboardStats; running: boolean }) {
  return (
    <div>
      <div className="grid cards">
        <StatCard k="Total" v={stats.total} />
        <StatCard k="Completadas" v={stats.completed} tone="ok" />
        <StatCard k="En proceso" v={stats.processing} tone="info" />
        <StatCard k="Pendientes" v={stats.pending} tone="warn" />
        <StatCard k="Errores" v={stats.errors} tone="err" />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <strong>{stats.progressPct}%</strong>
          <span className="row" style={{ gap: 18 }}>
            <span className="pill">ETA: {fmtEta(stats.etaSec)}</span>
            <span className="pill">Velocidad: {fmtBytes(stats.speedBytesPerSec)}/s</span>
            <span className="pill">{running ? '▶ En marcha' : '⏸ En pausa'}</span>
          </span>
        </div>
        <ProgressBar value={stats.progressPct} big />
      </div>
    </div>
  );
}
