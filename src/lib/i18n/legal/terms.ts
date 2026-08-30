import type { Locale } from "@/lib/i18n/locales";
import type { LegalDoc } from "./types";

const UPDATED = "August 12, 2026";

const terms: Record<Locale, LegalDoc> = {
  en: {
    title: "Terms of Service",
    updated: UPDATED,
    intro:
      "These Terms govern your use of Picacho. By creating an account or using the service, you agree to them.",
    sections: [
      {
        heading: "Using Picacho",
        paragraphs: [
          "You must be 18 or older to create an account. You're responsible for keeping your login credentials secure and for all activity that happens under your account.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You may not use Picacho to generate, upload, or request content that: depicts a real, identifiable person without their consent, including using their likeness for a character; sexualizes a minor in any way — this is strictly prohibited and will be reported to the relevant authorities; promotes violence, harassment, or hatred against individuals or groups; infringes someone else's intellectual property; or is otherwise illegal where you live.",
          "We may suspend or terminate accounts that violate this policy, with or without notice depending on severity.",
        ],
      },
      {
        heading: "Your content",
        paragraphs: [
          "You retain ownership of the prompts and character details you provide and, to the extent permitted by our AI providers' own terms, the content generated for you. You're responsible for how you use generated content, including complying with any laws about AI-generated or synthetic media disclosure that apply to you.",
        ],
      },
      {
        heading: "AI-generated content — no guarantee of accuracy",
        paragraphs: [
          "Picacho is AI and can make mistakes. Generated content may be inaccurate, unexpected, or not match your request despite our draft/review/validate pipeline. Review generated content before relying on or publishing it.",
        ],
      },
      {
        heading: "Subscription & billing",
        paragraphs: [
          "Subscriptions are billed monthly and processed by our payment provider, Stripe. Plan pricing and monthly generation allowances are described on the Pricing page. Your allowance resets at the start of each billing period; unused generations do not roll over. You can cancel at any time from Settings — cancelling stops the next renewal, and you keep full access and any remaining generations until the end of the period you've paid for.",
          "Requests blocked by your own brand rules, and requests a provider refuses before any rendering begins, never consume your allowance. If a generation fails after rendering has begun, contact support: we will review it and restore the credit where the fault was ours. If this is your first subscription and you have used fewer than 5 generations, you may request a full refund within 7 days of purchase by contacting support. Beyond that, payments are non-refundable except where a refund is required by applicable law.",
        ],
      },
      {
        heading: "Account termination",
        paragraphs: [
          "You may delete your account at any time from Settings, which permanently removes your data as described in our Privacy Policy. We may suspend or terminate accounts that violate these Terms, or for extended inactivity, with notice where practical.",
        ],
      },
      {
        heading: "Disclaimers & limitation of liability",
        paragraphs: [
          "Picacho is provided \"as is\" without warranties of any kind. To the fullest extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the service.",
        ],
      },
      {
        heading: "Governing law",
        paragraphs: [
          "These Terms are governed by the laws of Spain. Any dispute arising out of these Terms or your use of Picacho will be submitted to the courts of the city of Madrid, Spain — except where mandatory consumer-protection rules entitle you to bring proceedings in your own country of residence. If you are a consumer in the European Union, you may also use the European Commission's online dispute resolution platform.",
        ],
      },
      {
        heading: "Changes to these Terms",
        paragraphs: [
          "We may update these Terms as the product evolves. Continued use after a change means you accept the updated Terms.",
        ],
      },
      {
        heading: "Contact us",
        paragraphs: ["Questions about these Terms? Reach us at the support email listed in Settings."],
      },
    ],
  },
  es: {
    title: "Términos de servicio",
    updated: UPDATED,
    intro:
      "Estos Términos rigen tu uso de Picacho. Al crear una cuenta o usar el servicio, los aceptas.",
    sections: [
      {
        heading: "Uso de Picacho",
        paragraphs: [
          "Debes tener 18 años o más para crear una cuenta. Eres responsable de mantener seguras tus credenciales de acceso y de toda actividad que ocurra bajo tu cuenta.",
        ],
      },
      {
        heading: "Uso aceptable",
        paragraphs: [
          "No puedes usar Picacho para generar, subir o solicitar contenido que: represente a una persona real e identificable sin su consentimiento, incluyendo usar su imagen para un personaje; sexualice a un menor de cualquier forma —esto está estrictamente prohibido y será reportado a las autoridades correspondientes—; promueva violencia, acoso u odio contra personas o grupos; infrinja la propiedad intelectual de terceros; o sea ilegal en el lugar donde vives.",
          "Podemos suspender o cancelar cuentas que infrinjan esta política, con o sin previo aviso según la gravedad.",
        ],
      },
      {
        heading: "Tu contenido",
        paragraphs: [
          "Conservas la propiedad de las instrucciones y detalles de personaje que proporcionas y, en la medida permitida por los propios términos de nuestros proveedores de IA, del contenido generado para ti. Eres responsable de cómo usas el contenido generado, incluyendo el cumplimiento de cualquier ley sobre divulgación de contenido generado por IA o medios sintéticos que te sea aplicable.",
        ],
      },
      {
        heading: "Contenido generado por IA — sin garantía de exactitud",
        paragraphs: [
          "Picacho es IA y puede cometer errores. El contenido generado puede ser inexacto, inesperado o no coincidir con tu solicitud a pesar de nuestro pipeline de redacción/revisión/validación. Revisa el contenido generado antes de confiar en él o publicarlo.",
        ],
      },
      {
        heading: "Suscripción y facturación",
        paragraphs: [
          "Las suscripciones se facturan mensualmente y las procesa nuestro proveedor de pagos, Stripe. Los precios de los planes y las cuotas mensuales de generación se describen en la página de Precios. Tu cuota se restablece al inicio de cada período de facturación; las generaciones no utilizadas no se acumulan. Puedes cancelar en cualquier momento desde Ajustes: la cancelación detiene la próxima renovación y conservas el acceso completo y las generaciones restantes hasta el final del período pagado.",
          "Las solicitudes bloqueadas por tus propias reglas de marca, y las que un proveedor rechaza antes de que empiece cualquier renderizado, nunca consumen tu cuota. Si una generación falla una vez iniciado el renderizado, contacta con soporte: lo revisaremos y te devolveremos el crédito si el fallo fue nuestro. Si es tu primera suscripción y has usado menos de 5 generaciones, puedes solicitar el reembolso completo dentro de los 7 días posteriores a la compra contactando con soporte. Más allá de eso, los pagos no son reembolsables salvo que la ley aplicable exija un reembolso.",
        ],
      },
      {
        heading: "Cancelación de cuenta",
        paragraphs: [
          "Puedes eliminar tu cuenta en cualquier momento desde Ajustes, lo que elimina permanentemente tus datos según lo descrito en nuestra Política de privacidad. Podemos suspender o cancelar cuentas que infrinjan estos Términos, o por inactividad prolongada, con aviso previo cuando sea posible.",
        ],
      },
      {
        heading: "Renuncias y limitación de responsabilidad",
        paragraphs: [
          "Picacho se proporciona \"tal cual\", sin garantías de ningún tipo. En la medida máxima permitida por la ley, no somos responsables de daños indirectos, incidentales o consecuentes derivados de tu uso del servicio.",
        ],
      },
      {
        heading: "Ley aplicable",
        paragraphs: [
          "Estos Términos se rigen por la legislación de España. Cualquier disputa derivada de estos Términos o de tu uso de Picacho se someterá a los tribunales de la ciudad de Madrid, España, salvo que las normas imperativas de protección al consumidor te permitan litigar en tu país de residencia. Si eres consumidor en la Unión Europea, también puedes utilizar la plataforma de resolución de litigios en línea de la Comisión Europea.",
        ],
      },
      {
        heading: "Cambios a estos Términos",
        paragraphs: [
          "Podemos actualizar estos Términos a medida que el producto evolucione. El uso continuado tras un cambio implica la aceptación de los Términos actualizados.",
        ],
      },
      {
        heading: "Contáctanos",
        paragraphs: [
          "¿Preguntas sobre estos Términos? Escríbenos al correo de soporte que aparece en Ajustes.",
        ],
      },
    ],
  },
  pt: {
    title: "Termos de Serviço",
    updated: UPDATED,
    intro: "Estes Termos regem o uso do Picacho. Ao criar uma conta ou usar o serviço, você concorda com eles.",
    sections: [
      {
        heading: "Usando o Picacho",
        paragraphs: [
          "Você deve ter 18 anos ou mais para criar uma conta. Você é responsável por manter suas credenciais de login seguras e por toda a atividade realizada em sua conta.",
        ],
      },
      {
        heading: "Uso aceitável",
        paragraphs: [
          "Você não pode usar o Picacho para gerar, enviar ou solicitar conteúdo que: retrate uma pessoa real e identificável sem o seu consentimento, incluindo o uso de sua imagem para um personagem; sexualize um menor de qualquer forma — isso é estritamente proibido e será reportado às autoridades competentes; promova violência, assédio ou ódio contra indivíduos ou grupos; infrinja a propriedade intelectual de terceiros; ou seja ilegal no local onde você mora.",
          "Podemos suspender ou encerrar contas que violem esta política, com ou sem aviso prévio, dependendo da gravidade.",
        ],
      },
      {
        heading: "Seu conteúdo",
        paragraphs: [
          "Você mantém a propriedade dos prompts e detalhes de personagem que fornece e, na medida permitida pelos próprios termos dos nossos provedores de IA, do conteúdo gerado para você. Você é responsável por como usa o conteúdo gerado, incluindo o cumprimento de quaisquer leis sobre divulgação de conteúdo gerado por IA ou mídia sintética aplicáveis a você.",
        ],
      },
      {
        heading: "Conteúdo gerado por IA — sem garantia de precisão",
        paragraphs: [
          "O Picacho é IA e pode cometer erros. O conteúdo gerado pode ser impreciso, inesperado ou não corresponder ao seu pedido, apesar do nosso pipeline de rascunho/revisão/validação. Revise o conteúdo gerado antes de confiar nele ou publicá-lo.",
        ],
      },
      {
        heading: "Assinatura e cobrança",
        paragraphs: [
          "As assinaturas são cobradas mensalmente e processadas pelo nosso provedor de pagamentos, a Stripe. Os preços dos planos e as cotas mensais de geração estão descritos na página de Preços. Sua cota é renovada no início de cada período de cobrança; gerações não utilizadas não são acumuladas. Você pode cancelar a qualquer momento em Configurações — o cancelamento interrompe a próxima renovação e você mantém o acesso completo e as gerações restantes até o fim do período pago.",
          "Solicitações bloqueadas pelas suas próprias regras de marca, e as que um provedor recusa antes de qualquer renderização começar, nunca consomem sua cota. Se uma geração falhar depois de iniciada a renderização, entre em contato com o suporte: vamos revisar e devolver o crédito se a falha foi nossa. Se for sua primeira assinatura e você tiver usado menos de 5 gerações, pode solicitar o reembolso integral em até 7 dias após a compra entrando em contato com o suporte. Além disso, os pagamentos não são reembolsáveis, exceto quando a lei aplicável exigir.",
        ],
      },
      {
        heading: "Encerramento de conta",
        paragraphs: [
          "Você pode excluir sua conta a qualquer momento em Configurações, o que remove permanentemente seus dados conforme descrito em nossa Política de Privacidade. Podemos suspender ou encerrar contas que violem estes Termos, ou por inatividade prolongada, com aviso prévio quando possível.",
        ],
      },
      {
        heading: "Isenções e limitação de responsabilidade",
        paragraphs: [
          "O Picacho é fornecido \"como está\", sem garantias de qualquer tipo. Na máxima extensão permitida por lei, não somos responsáveis por danos indiretos, incidentais ou consequenciais decorrentes do uso do serviço.",
        ],
      },
      {
        heading: "Lei aplicável",
        paragraphs: [
          "Estes Termos são regidos pelas leis da Espanha. Qualquer disputa decorrente destes Termos ou do seu uso do Picacho será submetida aos tribunais da cidade de Madri, Espanha — exceto quando normas obrigatórias de proteção ao consumidor permitirem que você litigue em seu país de residência. Se você for consumidor na União Europeia, também pode usar a plataforma de resolução de litígios online da Comissão Europeia.",
        ],
      },
      {
        heading: "Alterações a estes Termos",
        paragraphs: [
          "Podemos atualizar estes Termos conforme o produto evolui. O uso continuado após uma alteração significa que você aceita os Termos atualizados.",
        ],
      },
      {
        heading: "Fale conosco",
        paragraphs: [
          "Dúvidas sobre estes Termos? Entre em contato pelo e-mail de suporte listado em Configurações.",
        ],
      },
    ],
  },
  it: {
    title: "Termini di servizio",
    updated: UPDATED,
    intro:
      "Questi Termini regolano il tuo utilizzo di Picacho. Creando un account o utilizzando il servizio, li accetti.",
    sections: [
      {
        heading: "Utilizzo di Picacho",
        paragraphs: [
          "Devi avere almeno 18 anni per creare un account. Sei responsabile della sicurezza delle tue credenziali di accesso e di tutte le attività svolte con il tuo account.",
        ],
      },
      {
        heading: "Uso consentito",
        paragraphs: [
          "Non puoi usare Picacho per generare, caricare o richiedere contenuti che: raffigurino una persona reale e identificabile senza il suo consenso, incluso l'uso della sua immagine per un personaggio; sessualizzino in qualsiasi modo un minore — ciò è severamente vietato e sarà segnalato alle autorità competenti; promuovano violenza, molestie o odio contro individui o gruppi; violino la proprietà intellettuale altrui; o siano altrimenti illegali nel luogo in cui vivi.",
          "Potremmo sospendere o chiudere account che violano questa politica, con o senza preavviso a seconda della gravità.",
        ],
      },
      {
        heading: "I tuoi contenuti",
        paragraphs: [
          "Mantieni la proprietà dei prompt e dei dettagli del personaggio che fornisci e, nella misura consentita dai termini dei nostri fornitori di IA, del contenuto generato per te. Sei responsabile di come utilizzi i contenuti generati, incluso il rispetto di eventuali leggi sulla divulgazione di contenuti generati da IA o media sintetici a te applicabili.",
        ],
      },
      {
        heading: "Contenuti generati dall'IA — nessuna garanzia di accuratezza",
        paragraphs: [
          "Picacho è un'IA e può commettere errori. I contenuti generati potrebbero essere imprecisi, inaspettati o non corrispondere alla tua richiesta nonostante la nostra pipeline di bozza/revisione/validazione. Rivedi i contenuti generati prima di farvi affidamento o pubblicarli.",
        ],
      },
      {
        heading: "Abbonamento e fatturazione",
        paragraphs: [
          "Gli abbonamenti sono fatturati mensilmente ed elaborati dal nostro fornitore di pagamenti, Stripe. I prezzi dei piani e le quote mensili di generazione sono descritti nella pagina Prezzi. La tua quota si azzera all'inizio di ogni ciclo di fatturazione; le generazioni non utilizzate non si accumulano. Puoi disdire in qualsiasi momento dalle Impostazioni: la disdetta interrompe il rinnovo successivo e mantieni l'accesso completo e le generazioni rimanenti fino alla fine del periodo pagato.",
          "Le richieste bloccate dalle tue stesse regole di brand, e quelle che un provider rifiuta prima che inizi qualsiasi rendering, non consumano mai la tua quota. Se una generazione fallisce dopo l'inizio del rendering, contatta il supporto: la esamineremo e ti riaccrediteremo il credito se la colpa era nostra. Se è il tuo primo abbonamento e hai usato meno di 5 generazioni, puoi richiedere il rimborso completo entro 7 giorni dall'acquisto contattando il supporto. Oltre a ciò, i pagamenti non sono rimborsabili salvo quando un rimborso sia richiesto dalla legge applicabile.",
        ],
      },
      {
        heading: "Chiusura dell'account",
        paragraphs: [
          "Puoi eliminare il tuo account in qualsiasi momento dalle Impostazioni, rimuovendo permanentemente i tuoi dati come descritto nella nostra Informativa sulla privacy. Potremmo sospendere o chiudere account che violano questi Termini, o per inattività prolungata, con preavviso quando possibile.",
        ],
      },
      {
        heading: "Esclusioni di responsabilità e limitazione di responsabilità",
        paragraphs: [
          "Picacho è fornito \"così com'è\", senza garanzie di alcun tipo. Nella misura massima consentita dalla legge, non siamo responsabili per danni indiretti, incidentali o consequenziali derivanti dall'uso del servizio.",
        ],
      },
      {
        heading: "Legge applicabile",
        paragraphs: [
          "Questi Termini sono regolati dalla legge spagnola. Qualsiasi controversia derivante da questi Termini o dal tuo utilizzo di Picacho sarà sottoposta ai tribunali della città di Madrid, Spagna — salvo che norme imperative a tutela dei consumatori ti consentano di agire nel tuo paese di residenza. Se sei un consumatore nell'Unione Europea, puoi anche utilizzare la piattaforma di risoluzione delle controversie online della Commissione Europea.",
        ],
      },
      {
        heading: "Modifiche a questi Termini",
        paragraphs: [
          "Potremmo aggiornare questi Termini con l'evolversi del prodotto. L'uso continuato dopo una modifica implica l'accettazione dei Termini aggiornati.",
        ],
      },
      {
        heading: "Contattaci",
        paragraphs: [
          "Domande su questi Termini? Scrivici all'indirizzo email di supporto indicato nelle Impostazioni.",
        ],
      },
    ],
  },
};

export default terms;
