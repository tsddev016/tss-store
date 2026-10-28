# TSS The Swift Store — site

Site estático (Vercel) + painel `/admin` para publicar jogos. Os arquivos dos jogos ficam em **GitHub Releases** deste repositório (repositório precisa ser **público** para o Hub baixar sem login).

- `public/index.html` — vitrine (lê `catalog.json`)
- `public/admin.html` — painel de publicação (usa um token do GitHub guardado só no seu navegador)
- `public/catalog.json` — catálogo que o TSS Hub lê (`{SITE}/catalog.json`)
- `vercel.json` — publica a pasta `public/`

Fluxo: painel → release com o zip → `catalog.json` atualizado (commit) → Vercel republica → Hub detecta “Nova versão”.
