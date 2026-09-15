[English](../../../RELEASE_NOTES.md) · [fr](../../fr/docs/RELEASE_NOTES.md) · [es](../../es/docs/RELEASE_NOTES.md) · [it](../../it/docs/RELEASE_NOTES.md) · [pt](RELEASE_NOTES.md) · [de](../../de/docs/RELEASE_NOTES.md)

# jaunt 0.1.0-beta.11

As atualizações compatíveis do host agora substituem o tempo de execução enquanto preservam os processos comuns do shell, seus diretórios de trabalho, o ambiente e o histórico do terminal. Os clientes reconectam-se automaticamente. Os hosts antigos precisam de uma migração protegida: o shells ativo não pode ser preservado retroactivamente, e o instalador ainda requer autorização explícita antes de os terminar.

A área de trabalho partilhada corrige as etiquetas de Configuração, as posições de tabulação instáveis, os saltos de histórico móvel e as mensagens de erro de tamanho excessivo. As páginas suportam a ordem de arrastar e soltar e o renomeamento de duplo- click; a barra lateral da área de trabalho pode entrar em colapso. Os programas de primeiro plano do Claude e do Codex usam ícones de marca Meteor localmente empacotados em páginas e legendas de painel. Outros programas mantêm o ícone terminal.

Web, desktop, Android e CLI suportam a detecção de linguagem do sistema e explícitas preferências de inglês, francês, espanhol, italiano, português e alemão. O inglês continua a ser a documentação do repositório canônico, com cópias traduzidas vinculadas. A página inicial da web introduz o projeto e fornece comandos de instalação copiáveis; aplicativos nativos abrem o espaço de trabalho diretamente.

O instalador oferece `--client-only` para um cliente de desktop sem instalar um host local ou expor controles de host locais. As operações de atualização e transferência mantêm o progresso visível e os resultados finais. As janelas de desktop são intituladas `jaunt`; o aplicativo web instalado é chamado `jaunt (PWA)`. Lançador e ícones da web usam a obra de arte transparente fornecida.

O protocolo não foi submetido a uma auditoria de segurança independente. A validação do telefone físico não é reivindicada. Veja [o relatório de validação](SEAMLESS_WORKSPACE_VALIDATION.md) para os testes observados e os limites restantes da plataforma.
