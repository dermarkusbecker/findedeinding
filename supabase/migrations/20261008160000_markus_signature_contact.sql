update public.communication_signatures
set email = 'markus@dermarkusbecker.de',
    website = 'findedeinding.com',
    updated_at = now()
where signer_name = 'Markus Becker'
  and (email is distinct from 'markus@dermarkusbecker.de'
    or website is distinct from 'findedeinding.com');
