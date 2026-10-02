const CONTACT_EMAIL = "ceestoremkt@gmail.com"

export default function DataDeletionPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">Exclusão de dados</h1>
      <p className="text-sm text-muted-foreground mb-8">Data deletion instructions — CEE Webstore (@cee_webstore)</p>

      <section className="space-y-4">
        <p>
          Se você interagiu com a conta <strong>@cee_webstore</strong> no Instagram e quer que seus dados sejam
          excluídos da nossa ferramenta de respostas automáticas, siga um dos caminhos abaixo.
        </p>

        <h2 className="text-xl font-semibold mt-6">Como pedir a exclusão</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Envie um e-mail para{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}?subject=Exclus%C3%A3o%20de%20dados`}>{CONTACT_EMAIL}</a>{" "}
            com o assunto <strong>&quot;Exclusão de dados&quot;</strong> e informe o seu nome de usuário do Instagram.
          </li>
          <li>
            Ou envie uma mensagem direta para @cee_webstore com o texto <strong>EXCLUIR MEUS DADOS</strong>.
          </li>
        </ol>

        <h2 className="text-xl font-semibold mt-6">O que é excluído</h2>
        <p>
          Seu identificador e nome de usuário do Instagram, os comentários e mensagens registrados, as informações de
          interação (incluindo se você segue a conta) e os registros de cliques em links.
        </p>

        <h2 className="text-xl font-semibold mt-6">Prazo</h2>
        <p>
          A exclusão é feita em até 15 dias após o pedido, e enviamos uma confirmação pelo mesmo canal usado na
          solicitação.
        </p>

        <p className="text-sm text-muted-foreground mt-8">
          Veja também a nossa <a className="underline" href="/privacy">Política de Privacidade</a>.
        </p>
      </section>
    </div>
  )
}
