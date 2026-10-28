# Contribuir para ROM Dock

Antes de iniciar uma alteração significativa, apresentar uma Issue com o problema e o comportamento pretendido. O suporte a outras consolas e protocolos encontra-se no trabalho futuro; novas integrações devem explicitar as capacidades e limitações do respetivo protocolo.

## Preparação

Seguir a instalação e as instruções de desenvolvimento no README. Utilizar dados de teste próprios, sem incluir ROMs, BIOS, credenciais ou conteúdos comerciais no repositório.

## Verificações

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run build
# Com o servidor ativo na porta 8765 e Chromium instalado:
cd frontend && npm test
```

A descrição da proposta deve identificar o problema, o comportamento resultante, as verificações realizadas e eventuais limitações. Alterações visuais devem incluir capturas em computador e telemóvel, nos temas afetados, com dados de demonstração.

## Convenções

- Manter a linguagem da interface e da documentação formal e objetiva.
- Não guardar credenciais ou dados da máquina em ficheiros versionados.
- Validar caminhos e a geração da ligação nas operações remotas.
- Preservar os originais perante falhas de transferência ou publicação.
- Respeitar a preferência de movimento reduzido e a navegação por teclado.
- Distinguir funcionalidades disponíveis de propostas de trabalho futuro.
