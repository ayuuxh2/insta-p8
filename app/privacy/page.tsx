const CONTACT_EMAIL = "ceestoremkt@gmail.com"

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground mb-8">Última atualização: outubro de 2026</p>

      <section className="space-y-4">
        <p>
          Esta ferramenta é operada pela <strong>CEE Webstore (@cee_webstore)</strong> e usa a API oficial do
          Instagram (Meta) para responder automaticamente a comentários e mensagens diretas enviados à conta
          @cee_webstore. Ela não é usada para enviar mensagens a quem não interagiu com a conta.
        </p>

        <h2 className="text-xl font-semibold mt-6">Dados tratados</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Identificador e nome de usuário do Instagram de quem comenta ou envia mensagem</li>
          <li>Texto do comentário ou da mensagem e a data da interação</li>
          <li>Se a pessoa segue a conta @cee_webstore (informação fornecida pela Meta após a interação)</li>
          <li>Cliques nos links enviados pela conversa</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Para que usamos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Enviar o conteúdo ou link que a pessoa pediu ao comentar ou tocar em um botão</li>
          <li>Evitar mensagens repetidas e respeitar os limites do Instagram</li>
          <li>Medir, de forma agregada, o desempenho das campanhas</li>
          <li>Não vendemos nem compartilhamos esses dados com terceiros</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Base legal e armazenamento</h2>
        <p>
          O tratamento se baseia no legítimo interesse de responder a quem iniciou o contato (LGPD, art. 7º, IX).
          Os dados ficam em banco de dados protegido (Supabase), acessível apenas ao operador da conta.
        </p>

        <h2 className="text-xl font-semibold mt-6">Seus direitos</h2>
        <p>
          Você pode parar de receber mensagens automáticas enviando <strong>SAIR</strong> na conversa e pode pedir
          acesso, correção ou exclusão dos seus dados pelo e-mail abaixo.
        </p>

        <h2 className="text-xl font-semibold mt-6">Contato</h2>
        <p>
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </section>
    </div>
  )
}
