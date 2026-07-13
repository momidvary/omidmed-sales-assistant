export type TableCell = string | number | null | undefined;

export type TableColumn<Row> = {
  key: keyof Row;
  label: string;
};

function normalize(value: TableCell) {
  if (value == null) return "";
  return String(value);
}

function escapeCsv(value: TableCell) {
  const text = normalize(value).replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${text}"` : text;
}

export function createCsv<Row extends Record<string, TableCell>>(
  columns: TableColumn<Row>[],
  rows: Row[],
) {
  const lines = [
    columns.map((column) => escapeCsv(column.label)).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsv(row[column.key])).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function escapeXml(value: TableCell) {
  return normalize(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelCell(value: TableCell) {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
}

export function createExcelXml<Row extends Record<string, TableCell>>(
  sheetName: string,
  columns: TableColumn<Row>[],
  rows: Row[],
) {
  const safeSheetName = sheetName.slice(0, 31).replace(/[\\/?*\[\]:]/g, "-");
  const header = columns
    .map(
      (column) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`,
    )
    .join("");
  const body = rows
    .map(
      (row) =>
        `<Row>${columns.map((column) => excelCell(row[column.key])).join("")}</Row>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/><Font ss:FontName="Tahoma" ss:Size="10"/></Style>
  <Style ss:ID="Header"><Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#DFF3EF" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(safeSheetName)}">
  <Table>
   <Row>${header}</Row>
   ${body}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

export function downloadResponse({
  body,
  filename,
  contentType,
}: {
  body: string;
  filename: string;
  contentType: string;
}) {
  return new Response(body, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
