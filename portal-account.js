const byId = (id) => document.getElementById(id);

function splitStreet(value = '') {
  const street = String(value || '').trim();
  const match = street.match(/^(.*?)\s+(\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?)$/);
  return match ? { streetName: match[1], houseNumber: match[2] } : { streetName: street, houseNumber: '' };
}

export function mountCustomerAccount({ request, showView, toast, adminPreviewMode, onSaved }) {
  const menu = byId('portalAccountMenu');
  const toggle = byId('portalProfileMenuButton');
  const form = byId('customerAccountForm');
  const status = byId('customerAccountStatus');
  const emailConfirmation = byId('accountEmailConfirmation');
  const whatsAppField = byId('accountWhatsAppField');
  let savedEmail = '';
  let busy = false;

  const field = (name) => form.elements.namedItem(name);
  const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  const open = () => { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); };
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const updateConditionalFields = () => {
    const changingEmail = field('email').value.trim().toLowerCase() !== savedEmail;
    emailConfirmation.hidden = !changingEmail;
    field('emailConfirmation').required = changingEmail;
    field('currentPassword').required = changingEmail;
    whatsAppField.hidden = field('whatsappSameAsMobile').checked;
  };
  const fill = (profile) => {
    const address = splitStreet(profile.street);
    const values = {
      name: profile.name, email: profile.email, phone: profile.phone,
      mobilePhone: profile.mobile_phone, birthDate: profile.birth_date,
      preferredChannel: profile.preferred_communication_channel || 'email',
      streetName: address.streetName, houseNumber: address.houseNumber,
      postalCode: profile.postal_code, city: profile.city, country: profile.country || 'Deutschland',
      whatsappPhone: profile.whatsapp_phone,
    };
    for (const [key, value] of Object.entries(values)) field(key).value = value || '';
    field('whatsappSameAsMobile').checked = profile.whatsapp_same_as_mobile === true;
    field('postalMailActive').checked = profile.postal_mail_active !== false;
    field('emailConfirmation').value = '';
    field('currentPassword').value = '';
    savedEmail = String(profile.email || '').trim().toLowerCase();
    updateConditionalFields();
  };

  toggle.addEventListener('click', () => { if (menu.hidden) open(); else close(); });
  document.addEventListener('click', (event) => { if (!menu.contains(event.target) && !toggle.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus(); } });
  byId('openCustomerAccount').addEventListener('click', async () => {
    close();
    showView('account');
    setStatus('Kontaktdaten werden geladen …');
    try {
      const data = await request('/api/customer-records?action=overview');
      fill(data.profile);
      setStatus(adminPreviewMode ? 'Diese Vorschau ist schreibgeschützt.' : '');
    } catch (error) { setStatus(error.message, true); }
  });
  byId('accountPhotoButton').addEventListener('click', () => byId('portalProfilePhotoInput').click());
  field('email').addEventListener('input', updateConditionalFields);
  field('whatsappSameAsMobile').addEventListener('change', updateConditionalFields);
  if (adminPreviewMode) {
    form.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
    byId('accountPhotoButton').disabled = true;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || adminPreviewMode || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    data.whatsappSameAsMobile = field('whatsappSameAsMobile').checked;
    data.postalMailActive = field('postalMailActive').checked;
    busy = true;
    form.querySelector('button[type="submit"]').disabled = true;
    setStatus('Kontaktdaten werden gespeichert …');
    try {
      const result = await request('/api/customer-records?action=profile-update', { method: 'PATCH', body: JSON.stringify(data) });
      onSaved(result);
      fill(result.profile);
      setStatus(result.syncWarning ? 'Gespeichert. Der Abgleich mit der CRM-Akte muss erneut geprüft werden.' : 'Deine Kontaktdaten wurden gespeichert und mit der Kundenakte abgeglichen.', result.syncWarning);
      if (result.emailChanged) toast('Deine neue E-Mail-Adresse gilt ab sofort für den Login.');
    } catch (error) { setStatus(error.message, true); }
    finally { busy = false; form.querySelector('button[type="submit"]').disabled = false; }
  });
}
