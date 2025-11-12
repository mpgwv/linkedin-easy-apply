const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class LinkedInJobsScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.jobs = [];
    }

    async initialize() {
        console.log('🚀 Inicializando LinkedIn Jobs Scraper...');
        
        this.browser = await puppeteer.launch({
            headless: false, // Alterar para true em produção
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        
        // Configurar user agent para parecer humano
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Configurar viewport
        await this.page.setViewport({ width: 1366, height: 768 });
    }

    async login(email, password) {
        try {
            console.log('🔐 Realizando login no LinkedIn...');
            
            await this.page.goto('https://www.linkedin.com/login', { 
                waitUntil: 'networkidle2' 
            });

            // Preencher credenciais
            await this.page.type('#username', email);
            await this.page.type('#password', password);
            
            // Clicar no botão de login
            await this.page.click('button[type="submit"]');
            
            // Aguardar navegação
            await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
            
            console.log('✅ Login realizado com sucesso!');
            
        } catch (error) {
            console.error('❌ Erro no login:', error);
            throw error;
        }
    }

    async searchJobs(keywords, location = 'Brasil', options = {}) {
        try {
            console.log(`🔍 Buscando vagas: "${keywords}" em ${location}...`);
            
            const searchUrl = this.buildSearchUrl(keywords, location, options);
            await this.page.goto(searchUrl, { 
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Aguardar carregamento dos resultados
            await this.page.waitForTimeout(5000);
            
            // Rolar página para carregar mais resultados
            await this.autoScroll();
            
            // Extrair vagas da página atual
            const pageJobs = await this.extractJobsFromPage();
            this.jobs = [...this.jobs, ...pageJobs];
            
            console.log(`✅ ${pageJobs.length} vagas encontradas nesta página`);
            
            return pageJobs;
            
        } catch (error) {
            console.error('❌ Erro na busca de vagas:', error);
            return [];
        }
    }

    buildSearchUrl(keywords, location, options = {}) {
        const baseUrl = 'https://www.linkedin.com/jobs/search/';
        const params = new URLSearchParams({
            keywords: keywords,
            location: location,
            f_AL: options.remote ? 'true' : 'false',
            f_E: options.experienceLevel || '',
            f_JT: options.jobType || '',
            f_WT: options.workType || '2', // Remoto
            sortBy: options.sortBy || 'DD', // Mais recentes
            f_TPR: options.timeRange || '',
            position: '1',
            pageNum: '0'
        });

        return `${baseUrl}?${params.toString()}`;
    }

    async autoScroll() {
        await this.page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
    }

    async extractJobsFromPage() {
        return await this.page.evaluate(() => {
            const jobs = [];
            
            // Seletores do LinkedIn (podem mudar)
            const jobCards = document.querySelectorAll('.job-search-card, [data-entity-urn*="jobPosting"]');
            
            jobCards.forEach((card) => {
                try {
                    const titleElement = card.querySelector('.job-card-list__title') || 
                                       card.querySelector('[class*="job-title"]');
                    const companyElement = card.querySelector('.job-card-container__company-name') || 
                                         card.querySelector('[class*="company-name"]');
                    const locationElement = card.querySelector('.job-card-container__metadata-item') || 
                                          card.querySelector('[class*="location"]');
                    const linkElement = card.querySelector('a');
                    const dateElement = card.querySelector('.job-card-container__listed-time') || 
                                      card.querySelector('time');
                    
                    if (titleElement && companyElement && linkElement) {
                        const job = {
                            title: titleElement.textContent?.trim() || '',
                            company: companyElement.textContent?.trim() || '',
                            location: locationElement?.textContent?.trim() || 'Não informado',
                            link: linkElement.href || '',
                            postedDate: dateElement?.textContent?.trim() || 'Recente',
                            platform: 'LinkedIn',
                            timestamp: new Date().toISOString()
                        };
                        
                        jobs.push(job);
                    }
                } catch (error) {
                    console.warn('Erro ao processar card:', error);
                }
            });
            
            return jobs;
        });
    }

    async getJobDetails(jobUrl) {
        try {
            await this.page.goto(jobUrl, { waitUntil: 'networkidle2' });
            await this.page.waitForTimeout(3000);
            
            return await this.page.evaluate(() => {
                const descriptionElement = document.querySelector('.jobs-description__content') || 
                                         document.querySelector('.description__text');
                
                const requirementsElement = document.querySelector('.jobs-description-content__text') || 
                                          document.querySelector('[class*="requirements"]');
                
                return {
                    description: descriptionElement?.textContent?.trim() || '',
                    requirements: requirementsElement?.textContent?.trim() || '',
                    fullText: document.body.textContent || ''
                };
            });
            
        } catch (error) {
            console.error('Erro ao obter detalhes da vaga:', error);
            return {};
        }
    }

    async searchMultipleKeywords(keywordsList, location = 'Brasil') {
        console.log('🎯 Iniciando busca por múltiplas keywords...');
        
        for (const keyword of keywordsList) {
            console.log(`\n📋 Buscando: "${keyword}"`);
            await this.searchJobs(keyword, location);
            
            // Delay entre buscas para evitar bloqueio
            await this.page.waitForTimeout(3000);
        }
        
        console.log(`\n✅ Busca concluída! Total de ${this.jobs.length} vagas encontradas.`);
        return this.jobs;
    }

    async saveToFile(filename = 'vagas_linkedin.json') {
        try {
            const data = {
                timestamp: new Date().toISOString(),
                totalJobs: this.jobs.length,
                jobs: this.jobs
            };
            
            await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
            console.log(`💾 Vagas salvas em: ${filename}`);
            
        } catch (error) {
            console.error('❌ Erro ao salvar arquivo:', error);
        }
    }

    filterJobs(filters = {}) {
        let filteredJobs = [...this.jobs];
        
        if (filters.keywords) {
            const keywords = filters.keywords.toLowerCase().split(' ');
            filteredJobs = filteredJobs.filter(job => 
                keywords.some(keyword => 
                    job.title.toLowerCase().includes(keyword) ||
                    job.company.toLowerCase().includes(keyword) ||
                    job.description?.toLowerCase().includes(keyword)
                )
            );
        }
        
        if (filters.companies) {
            const companies = filters.companies.map(c => c.toLowerCase());
            filteredJobs = filteredJobs.filter(job => 
                companies.includes(job.company.toLowerCase())
            );
        }
        
        if (filters.location) {
            filteredJobs = filteredJobs.filter(job => 
                job.location.toLowerCase().includes(filters.location.toLowerCase())
            );
        }
        
        return filteredJobs;
    }

    removeDuplicates() {
        const uniqueJobs = [];
        const seenLinks = new Set();
        
        for (const job of this.jobs) {
            if (!seenLinks.has(job.link)) {
                seenLinks.add(job.link);
                uniqueJobs.push(job);
            }
        }
        
        this.jobs = uniqueJobs;
        console.log(`🔄 Removidas ${this.jobs.length - uniqueJobs.length} vagas duplicadas`);
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Navegador fechado');
        }
    }
}

// Configuração e uso
const scraperConfig = {
    keywords: [
        'analista de sistemas sênior',
        'systems analyst senior',
        'desenvolvedor full stack',
        'software engineer'
    ],
    location: 'Brasil',
    options: {
        remote: true,
        experienceLevel: '4,5,6', // Sênior, Diretor, Executivo
        sortBy: 'DD', // Mais recentes
        timeRange: 'r86400' // Últimas 24 horas
    }
};

// Função principal
async function main() {
    const scraper = new LinkedInJobsScraper();
    
    try {
        await scraper.initialize();
        
        // 🔐 REMOVA ESTAS CREDENCIAIS EM PRODUÇÃO
        // Use variáveis de ambiente em vez disso
        await scraper.login('seu_email@exemplo.com', 'sua_senha');
        
        // Buscar vagas
        await scraper.searchMultipleKeywords(scraperConfig.keywords, scraperConfig.location);
        
        // Remover duplicatas
        scraper.removeDuplicates();
        
        // Salvar resultados
        await scraper.saveToFile('vagas_linkedin.json');
        
        // Exibir resumo
        console.log('\n📊 RESUMO DA BUSCA:');
        console.log(`• Total de vagas únicas: ${scraper.jobs.length}`);
        console.log(`• Empresas encontradas: ${new Set(scraper.jobs.map(job => job.company)).size}`);
        
        // Exemplo de filtragem
        const seniorJobs = scraper.filterJobs({ keywords: 'sênior senior' });
        console.log(`• Vagas sênior: ${seniorJobs.length}`);
        
    } catch (error) {
        console.error('❌ Erro na execução:', error);
    } finally {
        await scraper.close();
    }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = LinkedInJobsScraper;
