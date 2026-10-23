# Публикация документации

- Полная версия: https://corelab-team.github.io/grain-ocean-atlas/documentation/
- Export-only: https://corelab-team.github.io/grain-ocean-atlas/documentation/export-only/

Готовые сайты Astro Starlight и DOCX находятся в dist/documentation. Полная версия использует base /grain-ocean-atlas/documentation/, экспортная — /grain-ocean-atlas/documentation/export-only/.

Workflow .github/workflows/pages.yml публикует корневой dist по push main. Он не пересобирает Starlight: для обновления сначала соберите руководства с соответствующим base, замените готовые файлы в этих каталогах и отправьте main. Остальные страницы приложения сохраняются на своих адресах.
