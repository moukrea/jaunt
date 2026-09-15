[English](../../../AGENTS.md) · [fr](../fr/AGENTS.md) · [es](../es/AGENTS.md) · [it](../it/AGENTS.md) · [pt](AGENTS.md) · [de](../de/AGENTS.md)

# Orientações de contribuição jaunt

- Leia o SECURITY.md e docs/PROTOCOL.md antes de modificar o transporte.
- O shells arbitrário é o recurso principal. Não restrinja o acesso a agentes de IA.
- Nunca coloque segredos em URLs de solicitação, logs ou testes publicados; o pareamento usa o fragmento.
- Renderize conteúdo DOM remoto com o textoContent, nunca innerHTML. Sem scripts CDN em tempo de execução na UI.
- Nunca volte a reproduzir a entrada do terminal após a reconexão. Os envios usam offsets idempotent e o SHA-256 commits.
- Nunca envie o Enter automaticamente após colar uma imagem/caminho. Mostre as capacidades nativas reais.
- Não feche o PTYs quando um navegador se desconecta. Preservar identidade através de atualizações.
- Testes: pytest; nó --test tests/relay.test.mjs; npm run test:relay; python tests/browser_e.py.
- docs/VALIDATION.md registra observações, não promessas. Atualize-o com precisão.
- Escreva documentação do repositório, orientação da contribuição e notas de versão em inglês por padrão. A localização da aplicação é separada.
