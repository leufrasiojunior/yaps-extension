# YAPS Extension (YAPD Ad & Domain Sentinel)

Extensão de navegador (Chrome / Edge Manifest V3) para identificação ativa de anúncios, rastreadores e injeções JavaScript no DOM, integrada ao **YAPD** (*Yet Another Pi-hole Dashboard*).

## Funcionalidades
- **Detecção Passiva**: Monitora requisições third-party e carregamento de scripts externos.
- **Detecção de JS Injetado**: Mapeia inserções dinâmicas de tags `<script>` e `<iframe>` no DOM com rastreamento da pilha de chamadas.
- **Element Picker Interativo**: Mira visual para clicar em anúncios na página e identificar domínios de origem.
- **Envio Silencioso em Lotes**: Agrupa detecções com buffer de debounce e envia diretamente para a API do YAPD para bloqueio no Pi-hole via DNS.
