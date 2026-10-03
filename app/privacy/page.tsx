const CONTACT_EMAIL = "ceestoremkt@gmail.com"

export const metadata = { title: "Política de Privacidade — CEE Store" }

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">Política de Privacidade</h1>
      <p className="text-sm text-muted-foreground mb-8">Última atualização: outubro de 2026</p>

      <section className="space-y-4">
        <p>
          Esta ferramenta é operada pela <strong>CEE Webstore (@cee_webstore)</strong>, que é a controladora dos dados
          descritos aqui. Ela usa a API oficial do Instagram (Meta) para responder automaticamente a quem comenta nos posts
          ou envia mensagem direta para a conta @cee_webstore. Ela não envia mensagens para quem não interagiu com a conta.
        </p>

        <h2 className="text-xl font-semibold mt-6">Dados tratados</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Identificador e nome de usuário do Instagram de quem comenta, envia mensagem ou interage com Stories</li>
          <li>Texto do comentário ou da mensagem, a palavra-chave que ativou a resposta e a data da interação</li>
          <li>Toques nos botões das mensagens e cliques nos links enviados</li>
          <li>Se a pessoa segue a conta @cee_webstore (informação fornecida pela Meta depois da interação)</li>
          <li>Etiquetas (tags) internas usadas para organizar os contatos, como o interesse num produto</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Para que usamos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Enviar o conteúdo, arquivo ou link que a pessoa pediu ao comentar, mandar mensagem ou tocar em um botão</li>
          <li>Liberar conteúdos exclusivos para seguidores, quando a pessoa pede o conteúdo</li>
          <li>Evitar mensagens repetidas e respeitar os limites do Instagram</li>
          <li>Medir o desempenho das campanhas (quantas pessoas pediram, receberam e clicaram)</li>
        </ul>
        <p>Não vendemos nem compartilhamos esses dados com terceiros para fins de marketing.</p>

        <h2 className="text-xl font-semibold mt-6">Base legal</h2>
        <p>
          Legítimo interesse em responder a quem iniciou o contato com a conta (LGPD, art. 7º, IX), sempre com a opção de
          sair da lista e de pedir a exclusão dos dados a qualquer momento.
        </p>

        <h2 className="text-xl font-semibold mt-6">Onde ficam e por quanto tempo</h2>
        <p>
          Os dados ficam em banco de dados protegido (Supabase) e o sistema roda na Vercel; esses fornecedores podem
          armazenar dados em servidores fora do Brasil, com proteções contratuais. O acesso é restrito ao operador da conta.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Histórico de interações: até 12 meses</li>
          <li>Links rastreados enviados: até 180 dias</li>
          <li>Registro técnico de mensagens recebidas (para diagnóstico): 14 dias</li>
          <li>Dados de contato: enquanto houver interação, ou até o pedido de exclusão</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Seus direitos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Parar de receber mensagens automáticas:</strong> envie <strong>SAIR</strong> na conversa com
            @cee_webstore (para voltar, envie <strong>VOLTAR</strong>).
          </li>
          <li>
            <strong>Excluir seus dados:</strong> envie <strong>EXCLUIR MEUS DADOS</strong> na conversa com @cee_webstore. A
            exclusão é imediata e automática. Veja também a <a className="underline" href="/exclusao-de-dados">página de exclusão de dados</a>.
          </li>
          <li>Acesso, correção ou outras solicitações: pelo e-mail abaixo.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6">Contato</h2>
        <p>
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </section>
    </div>
  )
}
