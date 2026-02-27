declare module 'pdf-parse' {
  interface PdfData {
    numpages: number
    numrender: number
    info: Record<string, string>
    metadata: unknown
    text: string
  }

  function pdfParse(dataBuffer: Buffer): Promise<PdfData>
  export default pdfParse
}
