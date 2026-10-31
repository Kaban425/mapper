// The body of a GitHub release draft (plan/eng.md §9). The risk text comes from the READMEs, so
// it is written once; everything else is the CHANGELOG section and the files' SHA-256.

export const RISK_HEADING = { ru: "## Честно о риске", en: "## Honest about the risk" };

/** The first paragraph under `heading`, joined into one line. */
export function firstParagraph(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) throw new Error(`README: no "${heading}" section`);
  const paragraph = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#") || (line.trim() === "" && paragraph.length > 0)) break;
    if (line.trim() !== "") paragraph.push(line.trim());
  }
  if (paragraph.length === 0) throw new Error(`README: "${heading}" is empty`);
  return paragraph.join(" ");
}

const describe = (name) =>
  name.endsWith("-setup.exe")
    ? "установщик: для текущего пользователя, без прав администратора, удаляется в «Параметры → Приложения» · installer: current user, no administrator rights, removed in Settings → Apps"
    : "portable: запускается без установки · runs without installing";

/** `files`: `{ name, sha256 }` sorted by name; `readmes`: `{ ru, en }` texts. */
export function renderNotes({ version, repo, files, changes, readmes }) {
  if (!changes) throw new Error(`CHANGELOG.md has no notes for ${version}`);
  if (files.length === 0) throw new Error("no .exe files to release");
  return [
    changes,
    "",
    "## Скачать · Download",
    "",
    "| Файл · File | |",
    "|---|---|",
    ...files.map((file) => `| \`${file.name}\` | ${describe(file.name)} |`),
    "",
    "Файлы не подписаны сертификатом, поэтому Windows SmartScreen может предупредить: «Подробнее» → «Выполнить в любом случае».",
    "The files are not code-signed, so Windows SmartScreen may warn: “More info” → “Run anyway”.",
    "",
    "## Проверка · Verify",
    "",
    "SHA-256 (то же в `SHA256SUMS.txt` · the same in `SHA256SUMS.txt`):",
    "",
    "```text",
    ...files.map((file) => `${file.sha256}  ${file.name}`),
    "```",
    "",
    "`Get-FileHash .\\<файл>` в PowerShell покажет то же значение · prints the same value in PowerShell.",
    "Собрано в GitHub Actions из этого тега · built by GitHub Actions from this tag:",
    "",
    "```text",
    `gh attestation verify ${files[0].name} --repo ${repo} --source-ref refs/tags/v${version} --signer-workflow ${repo}/.github/workflows/release.yml`,
    "```",
    "",
    "## Риск · Risk",
    "",
    firstParagraph(readmes.ru, RISK_HEADING.ru),
    "",
    firstParagraph(readmes.en, RISK_HEADING.en),
    "",
  ].join("\n");
}
