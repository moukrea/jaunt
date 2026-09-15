[English](../../../SEAMLESS_WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [es](../../es/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [it](../../it/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [pt](SEAMLESS_WORKSPACE_VALIDATION.md) · [de](../../de/docs/SEAMLESS_WORKSPACE_VALIDATION.md)

# Validação do espaço de trabalho e atualização em tempo de execução — 2026-09-15

Versões de candidatos: host `0.1.0b11`, desktop `0.1.0-beta.10`, Android `0.1.0-beta.8` / código de versão 8. Verificação de publicação está pendente enquanto este ramo está sob teste. Nenhum host de produção ou usuário comum shell foi parado para estes testes.

## Resultados observados

* Comando * Resultado observado *
| --- | --- |
| `.venv/bin/python -m pytest -q` Passaram 77 testes, incluindo primeiro plano real PTY transições do programa.
□ `npm test` □ 30 testes passaram.
| `npm run test:relay` □ Ambos os valores reais Miniflare/workerd WebSocket cenários passados.
□ `.venv/bin/python scripts/check_project.py` □ Python/JavaScript sintaxe, importação local, recursos de página e sintaxe do instalador passou.
□ `.venv/bin/python tests/browser_e2e.py` □ 23 cenários passados com PTYs real, autenticação, reconexões, comparações de byte, fallback da área de transferência e revogação.
| `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` Os mesmos 23 cenários passaram através da implementação real do trabalhador.
□ `.venv/bin/python tests/terminal_render_e2e.py` □ Real isolated `claude` e `codex` startup, seus ícones de guia/painel do Meteor, dimensões terminal, seleção e rolagem-para-latest passaram. Nenhuma invocação autenticada do modelo.
`DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` Electron e navegador compartilhado um PTY, propriedade de dimensões, controles de sessão e grupos de divisão persistentes passaram.
□ `.venv/bin/python tests/feedback_e2e.py` □ apertos de mão/RPCs interrompidos, feedback contextual limitado, controles de progresso e comutação entre hosts reais passados.
O `.venv/bin/python tests/workspace_usability_e2e.py`, posições de tabulação estáveis, reordenação do ponteiro, renomeação de duplo-clique, nenhum renome de longa-pressão, estado de barra lateral salvo, configurações responsivas e âncora de rolagem móvel retida passou.
□ `.venv/bin/python tests/i18n_e2e.py` □ Seis locais de navegador, sobreposições explícitas salvas e seis idiomas de ajuda CLI passaram; argumentos de comando e dados de usuário literais permaneceram inalterados.
□ `.venv/bin/python tests/handoff_e2e.py` □ Execução real do tempo de execução do `exec` retido daemon/PTY PIDs, ambiente, cwd e execução de comando do navegador. O shell herdado ainda pode ser encerrado.
`.venv/bin/python scripts/build_release.py`, em seguida, `.venv/bin/python tests/installer_e2e.py`, uma roda instalada substituiu seu tempo de execução, mantendo um verdadeiro shell vivo. Registros de identidade e dispositivo permaneceram intactos; nenhum gerenciador de serviço de conta foi tocado.
| `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` O verdadeiro servidor de legados públicos recusou a migração com um ativo shell. Reiniciação explícita deste dispositivo isolado fechou-o e preservou identidade/dispositivos.
| `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` □ Actual Electron O modo somente cliente não foi feito local CLI chamadas; emparelhados através do relé de proprietário implantado e executado um comando em um host remoto isolado. `jaunt` o título da janela passou.
- `npm audit --omit=optional` - Nenhuma vulnerabilidade relatada.
| `.venv/bin/python -m pip_audit` Não existem vulnerabilidades de dependência conhecidas. O próprio projeto instalado localmente não é uma distribuição auditável do PyPI.
□ Android Gradle release/debug builds, unit tests and lint □ Passado após substituir um auxiliar de fluxo somente API-33 por um loop de leitura compatível com API 26 mínima. Permanecem os avisos de deprecação e outros não-fatais.

O cenário nativo somente para clientes usa o relé WSS real do proprietário porque um relé loopback inseguro não deve ser aceito a partir de uma origem de aplicação empacotada. Seu estado host e shell são dispositivos de teste temporários. Nenhum material de emparelhamento está incluído neste relatório.

## Os restantes limites de validação

Instalação pública de lançamento, atualizações de aplicativos instaladas, a página publicada e o APK assinado final são verificados após a publicação; suas observações serão anexadas aqui. Câmera Android física, galeria, push de tela de bloqueio e Wi-Fi / handover móvel não foram testados em um telefone físico autorizado. Observações emuladoras são relatadas separadamente. Um lançador ou navegador pode controlar o mascaramento de ícones e aprovação de alterações instaladas do nome PWA / icon.

As máquinas sem transferência de tempo de execução precisam de uma migração protegida. O shells comum existente nessas versões não pode ser preservado retroativamente pelo novo código. As atualizações compatíveis retêm processos; um reboot explícito do servidor, falha ou reinicialização da máquina não é feito sobrevivível por este mecanismo.

O protocolo de encriptação **não recebeu uma auditoria de segurança independente**. Os testes funcionais não alteram esse estado.
