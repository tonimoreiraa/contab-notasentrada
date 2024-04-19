import puppeteer, { ElementHandle, Page } from "puppeteer"
import fs from 'fs/promises'
import cliProgress from 'cli-progress'
import path from 'path'
import { Command } from "commander";
const program = new Command();

program
  .version("1.0.0")
  .description("Contab Notas de Entrada")
  .option("-o, --output <output path>", "Caminho da saída")
  .parse(process.argv)

const options = program.opts()
const outputBasePath = [options.output] ?? [__dirname, 'output']

async function waitForDownload(page: Page)
{
    await page.waitForSelector('.black-overlay')
    await page.waitForSelector('.black-overlay', { hidden: true, timeout: 60000 })
}

export async function main()
{
    const bar = new cliProgress.SingleBar({
        format: ' {bar} | {empresa}: {status} | {value}/{total}'
    }, cliProgress.Presets.shades_classic)

    // Parse companies CSV
    const csv = await fs.readFile(__dirname + '/input.csv', { encoding: 'utf-8' })
    const rows = csv.split('\n').map(r => r.split(';'))
    const data = rows.slice(1).map(row => Object.fromEntries(row.map((value, i) => [rows[0][i], value])))

    // Launch browser
    const browser = await puppeteer.launch({ headless: false })
    const page = await browser.newPage()

    bar.start(Object.keys(data).length, 0)
    var i = 0;
    for (const row of data) {
        try {
            i = i + 1
            bar.update(i, { empresa: row.EMPRESA, status: 'Autenticando' })

            // Sign-in
            await page.goto('https://contribuinte.sefaz.al.gov.br/#/')
            await page.waitForSelector('.action-button')
            await page.click('.action-button')
            await page.waitForSelector('#username')
            await page.waitForSelector('#password')
            await page.type('#username', row.LOGIN)
            await page.type('#password', row.SENHA)
            page.click('button[type="submit"]')
            await page.waitForSelector('#mensagem-logado-como', {timeout: 60000})

            // Search
            let date = new Date()
            date.setDate(0)

            bar.update(i, { empresa: row.EMPRESA, status: 'Buscando Relatório Notas Fiscais de Entrada' })
            await page.goto('https://contribuinte.sefaz.al.gov.br/cobrancadfe/#/relatorio-notas-fiscais-entrada')
            await page.waitForSelector('#conjuntoCnpj > option:nth-child(2)')

            const option = await page.$eval('#conjuntoCnpj > option:nth-child(2)', element => element.value)
            await page.select('#conjuntoCnpj', option)
            
            const outputDir = path.join(...outputBasePath, `${row.EMPRESA} - ${option}`)
            const client = await page.createCDPSession()
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: outputDir,
            })

            date = new Date()
            date.setDate(0)
            const endDate = await page.waitForSelector('#periodoTermino') as ElementHandle
            await endDate.type(date.toLocaleDateString('pt-BR'))

            date.setDate(1)
            const startDate = await page.waitForSelector('#periodoInicio') as ElementHandle
            await startDate.type(date.toLocaleDateString('pt-BR'))
            await page.select('#tipoRelatorio', 'xlsx')

            await page.click('#botaoConsulta')
            bar.update(i, { empresa: row.EMPRESA, status: 'Baixando Relatório Notas Fiscais de Entrada', })
            await waitForDownload(page)
            await new Promise((resolve) => setTimeout(resolve, 1000))

            bar.update(i, { empresa: row.EMPRESA, status: 'Logout' })
            await page.evaluate(() => {
                // @ts-ignore
                localStorage.clear()
            })
        } catch (e: any) {
            console.error(`${row.EMPRESA}: ${e.message}`)
            await page.evaluate(() => {
                // @ts-ignore
                localStorage.clear()
            })
        }
    }
    
    bar.stop()
}

main()