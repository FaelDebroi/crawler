"use client";

import { useState } from "react";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  );
}

function CredentialField({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);

  const masked = value.replace(/./g, "•");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3">
        <span className="flex-1 font-mono text-sm text-zinc-200 select-none">
          {visible ? value : masked}
        </span>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="text-zinc-500 transition-colors hover:text-zinc-200"
          aria-label={visible ? "Ocultar" : "Mostrar"}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
    </div>
  );
}

type Props = {
  email: string;
  password: string;
};

export default function CredentialsCard({ email, password }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-sm font-medium text-zinc-300">Conta vinculada</span>
      </div>
      <div className="flex flex-col gap-4">
        <CredentialField label="Email" value={email} />
        <CredentialField label="Senha" value={password} />
      </div>
      <p className="mt-4 text-xs text-zinc-600">
        Credenciais somente leitura — altere via variáveis de ambiente.
      </p>
    </div>
  );
}
