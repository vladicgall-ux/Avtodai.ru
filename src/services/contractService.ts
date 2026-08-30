import type { BookingWithPeople } from './bookingService';
import { displayName } from '../utils/displayName';
import { formatDate, rentalDays } from '../utils/dateFormat';
import { config } from '../config';

function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Подчёркнутое поле для заполнения от руки — там, где сервис данные не собирает
 *  (паспорт, ВУ, VIN, СТС и т.п. — платформа сознательно не хранит такие
 *  персональные данные, это забота сторон при личной встрече). */
function blank(width = 24): string {
  return `<span class="blank" style="display:inline-block;min-width:${width}ch;border-bottom:1px solid #000;">&nbsp;</span>`;
}

export type ContractVariant = 'filled' | 'blank';

/**
 * Заполняет типовой договор аренды ТС без экипажа данными подтверждённой
 * брони — именами сторон, автомобилем, датами и суммами. Поля, которые
 * сервис не запрашивает при регистрации (паспортные данные, ВУ, VIN, СТС),
 * остаются пустыми строками для заполнения от руки при личной встрече —
 * автодай.рф выступает только информационным посредником (ст. 1253.1 ГК РФ)
 * и не должен собирать данные, ему не принадлежащие по сути сделки.
 *
 * variant='blank' дополнительно очищает ФИО и телефоны обеих сторон, оставляя
 * их пустыми строками для заполнения от руки. Причина: ФИО в профиле —
 * то, что пользователь ввёл сам при регистрации, сервис его не проверяет
 * (см. requireActiveUser) — если это не настоящее имя, «заполненный»
 * вариант зафиксирует его в подписываемом договоре. «Чистый» вариант
 * позволяет сторонам вписать реальные данные по документам при встрече,
 * сохраняя при этом объективные условия сделки (авто, даты, суммы),
 * которые от профиля не зависят.
 */
export function renderContractHtml(booking: BookingWithPeople, variant: ContractVariant = 'filled'): string {
  const ownerName = variant === 'blank' ? '' : displayName(booking.owner_full_name, booking.owner_first_name);
  const renterName = variant === 'blank' ? '' : displayName(booking.renter_full_name, booking.renter_first_name);
  const ownerPhone = variant === 'blank' ? null : booking.owner_phone;
  const renterPhone = variant === 'blank' ? null : booking.renter_phone;
  const days = rentalDays(booking.date_from, booking.date_to);
  const contractNumber = String(booking.id).padStart(6, '0');
  const today = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<title>Договор аренды № ${esc(contractNumber)} — ${esc(config.serviceName)}</title>
<style>
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 14px; line-height: 1.5; color: #111; max-width: 780px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 16px; text-align: center; }
  h2 { font-size: 14px; margin-top: 24px; }
  .meta { display: flex; justify-content: space-between; margin: 12px 0 24px; }
  .party { margin: 10px 0; }
  .sign-row { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign-row div { width: 45%; }
  .sign-line { border-bottom: 1px solid #000; display: inline-block; min-width: 160px; }
  .note { color: #555; font-size: 12px; margin-top: 32px; }
  @media print { .no-print { display: none; } body { margin: 0; } }
  .no-print { position: sticky; top: 0; background: #fff; padding: 8px 0; border-bottom: 1px solid #ccc; margin-bottom: 16px; text-align: center; }
  .no-print button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
</style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">🖨 Печать / сохранить как PDF</button></div>

  <h1>ДОГОВОР АРЕНДЫ ТРАНСПОРТНОГО СРЕДСТВА БЕЗ ЭКИПАЖА № ${esc(contractNumber)}</h1>
  ${variant === 'blank' ? '<p style="text-align:center;color:#555;font-size:12px;">Чистый бланк — ФИО и телефоны сторон впишите от руки по документам при личной встрече.</p>' : ''}
  <div class="meta">
    <span>г. ${blank(20)}</span>
    <span>«${esc(today)}»</span>
  </div>

  <p class="party"><b>Арендодатель:</b> ФИО ${ownerName ? esc(ownerName) : blank(30)}${variant === 'filled' && booking.owner_username ? ` (@${esc(booking.owner_username)})` : ''},<br/>
  Паспорт: серия ${blank(8)} № ${blank(10)}, выдан ${blank(40)},<br/>
  Телефон: ${ownerPhone ? esc(ownerPhone) : blank(20)}, Адрес: ${blank(50)}, с одной стороны, и</p>

  <p class="party"><b>Арендатор:</b> ФИО ${renterName ? esc(renterName) : blank(30)}${variant === 'filled' && booking.renter_username ? ` (@${esc(booking.renter_username)})` : ''},<br/>
  Паспорт: серия ${blank(8)} № ${blank(10)}, выдан ${blank(40)},<br/>
  Водительское удостоверение: серия ${blank(8)} № ${blank(10)}, выдано ${blank(30)},<br/>
  Телефон: ${renterPhone ? esc(renterPhone) : blank(20)}, Адрес: ${blank(50)}, с другой стороны, заключили настоящий Договор:</p>

  <h2>1. ПРЕДМЕТ ДОГОВОРА</h2>
  <p>1.1. Арендодатель передает, а Арендатор принимает во временное владение и пользование без экипажа автомобиль:<br/>
  Марка/Модель: ${esc(booking.brand)} ${esc(booking.model)}, Год: ${esc(booking.year)}, Цвет: ${blank(15)},<br/>
  Гос. номер: ${blank(15)}, VIN: ${blank(20)},<br/>
  СТС: серия ${blank(8)} № ${blank(10)}.</p>
  <p>1.2. Автомобиль используется исключительно в личных целях. Субаренда и использование в коммерческих целях (такси) запрещены без письменного согласия Арендодателя.</p>

  <h2>2. РАСЧЕТЫ И СРОКИ</h2>
  <p>2.1. Срок аренды: с «${esc(formatDate(booking.date_from))}» по «${esc(formatDate(booking.date_to))}» (${esc(days)} дн.).</p>
  <p>2.2. Стоимость аренды: ${esc(booking.price_per_day)} руб./сутки. Общая сумма: ${esc(booking.total_price)} руб.</p>
  <p>2.3. Залог (обеспечительный платеж): ${esc(booking.deposit)} руб. Возвращается Арендатору после сдачи исправного авто и проверки отсутствия штрафов с камер фиксации (в течение ${blank(4)} дней).</p>

  <h2>3. ОБЯЗАННОСТИ И ОТВЕТСТВЕННОСТЬ СТОРОН</h2>
  <p>3.1. Арендатор обязуется бережно эксплуатировать авто, соблюдать ПДД РФ, заправлять качественным топливом (АИ-${blank(4)}) и оплачивать все выписанные за период аренды штрафы ГИБДД/парковок.</p>
  <p>3.2. В случае повреждения автомобиля или ДТП по вине Арендатора, Арендатор возмещает полную стоимость ремонта и ущерба.</p>
  <p>3.3. Сервис «${esc(config.serviceName)}» предоставил исключительно информационную площадку для контакта Сторон, не является стороной настоящего Договора и освобожден от любых претензий и ответственности.</p>

  <div class="sign-row">
    <div>АРЕНДОДАТЕЛЬ: <span class="sign-line">&nbsp;</span> / (подпись)</div>
    <div>АРЕНДАТОР: <span class="sign-line">&nbsp;</span> / (подпись)</div>
  </div>

  <h2>АКТ ПРИЕМА-ПЕРЕДАЧИ К ДОГОВОРУ № ${esc(contractNumber)}</h2>
  <p>Пробег: ${blank(10)} км. Уровень топлива: ${blank(10)}.<br/>
  Документы (СТС, ОСАГО) и ключи переданы.<br/>
  Зафиксированные дефекты кузова/салона: ${blank(60)}<br/>
  Претензий к состоянию ТС нет.</p>

  <div class="sign-row">
    <div>Сдал (Арендодатель): <span class="sign-line">&nbsp;</span></div>
    <div>Принял (Арендатор): <span class="sign-line">&nbsp;</span></div>
  </div>

  <p class="note">Документ автоматически сформирован сервисом ${esc(config.serviceDomain)} на основании данных бронирования № ${esc(contractNumber)}.
  ${esc(config.serviceName)} — информационный посредник (ст. 1253.1 ГК РФ), не является стороной сделки и не проверяет заполненные вручную поля.
  Поля, отмеченные подчёркиванием, стороны заполняют самостоятельно при личной встрече по документам, удостоверяющим личность.</p>
</body>
</html>`;
}
