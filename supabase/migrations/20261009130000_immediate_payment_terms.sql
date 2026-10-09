-- Keep the default tariff wording aligned with the already immediate invoice due date.
update public.service_tariffs
set payment_due = 'zahlbar sofort'
where code = 'fdd-8-wochen'
  and payment_due = '7 Tage nach Abschluss';
