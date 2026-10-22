"""Выписка из другого банка в формате 1С (1CClientBankExchange) для персоны p3b.

Запуск:  python make_statement.py ../personas/p3b.json ../statements/p3b_other_bank_1c.txt
Кодировка windows-1251, переводы строк CRLF — как выгружает реальный клиент-банк.
Логика согласована с данными Альфы: еженедельные «переводы собственных средств»
из этого банка в Альфу совпадают с OWN_TRANSFER в p3b.json.
"""
import json
import random
import sys
from datetime import date, timedelta

OTHER_BANK = "АО «Банк Пример» (синтетический)"
OTHER_BIK = "044525999"
OTHER_KS = "30101810100000000999"
OTHER_ACC = "40802810900000001234"
ALFA_BIK = "044525593"


def main(src, dst):
    p = json.loads(open(src, encoding="utf-8").read())
    inn = p["registry"]["inn"]
    name = p["registry"]["name"]
    alfa_acc = p["alfa"]["account"]["number"]
    own = [t for t in p["alfa"]["transactions"] if t["kind"] == "OWN_TRANSFER" and "р/с в" in t["purpose"]]
    own_by_date = {t["date"]: t["amount"] for t in own}
    start = date.fromisoformat(p["alfa"]["account"]["opened"])
    end = date.fromisoformat(p["alfa"]["account"]["balance_as_of"])
    rnd = random.Random("p3b-other")
    docs = []
    bal = 0.0
    opening = bal
    n = 500
    total_in = total_out = 0.0
    d = start
    # выручка по эквайрингу в этом банке: свои переводы в Альфу ≈ 60% от неё
    weekly_out = {}
    for ds, amt in own_by_date.items():
        weekly_out[date.fromisoformat(ds)] = amt
    while d <= end:
        # дневная выручка: так, чтобы за неделю ≈ перевод / 0.6
        nxt = min((k for k in weekly_out if k >= d), default=None)
        week_amt = weekly_out.get(nxt, 0) / 0.6 if nxt else 0
        daily = round(week_amt / 7 * rnd.uniform(0.8, 1.2), 2)
        if daily > 0:
            n += 1
            docs.append(dict(n=n, d=d, amt=daily, direction="IN", payer=OTHER_BANK, payer_inn="7700000001",
                             payer_acc=OTHER_KS, receiver=name, receiver_inn=inn, receiver_acc=OTHER_ACC,
                             purpose=f"Возмещение по операциям эквайринга за {(d - timedelta(days=1)).strftime('%d.%m.%Y')}. Без НДС"))
            bal += daily
            total_in += daily
        if d in weekly_out:
            amt = weekly_out[d]
            n += 1
            docs.append(dict(n=n, d=d, amt=amt, direction="OUT", payer=name, payer_inn=inn, payer_acc=OTHER_ACC,
                             receiver=name, receiver_inn=inn, receiver_acc=alfa_acc, receiver_bik=ALFA_BIK,
                             purpose="Перевод собственных средств на р/с в АО «Альфа-Банк». Без НДС"))
            bal -= amt
            total_out += amt
        if d.day == 1:
            fee = 990.0
            n += 1
            docs.append(dict(n=n, d=d, amt=fee, direction="OUT", payer=name, payer_inn=inn, payer_acc=OTHER_ACC,
                             receiver=OTHER_BANK, receiver_inn="7700000001", receiver_acc=OTHER_KS,
                             purpose="Комиссия за обслуживание счёта"))
            bal -= fee
            total_out += fee
        d += timedelta(days=1)
    closing = round(opening + total_in - total_out, 2)
    L = []
    a = L.append
    a("1CClientBankExchange")
    a("ВерсияФормата=1.03")
    a("Кодировка=Windows")
    a("Отправитель=Бухгалтерия предприятия")
    a("Получатель=")
    a(f"ДатаСоздания={end.strftime('%d.%m.%Y')}")
    a("ВремяСоздания=10:00:00")
    a(f"ДатаНачала={start.strftime('%d.%m.%Y')}")
    a(f"ДатаКонца={end.strftime('%d.%m.%Y')}")
    a(f"РасчСчет={OTHER_ACC}")
    a("СекцияРасчСчет")
    a(f"ДатаНачала={start.strftime('%d.%m.%Y')}")
    a(f"ДатаКонца={end.strftime('%d.%m.%Y')}")
    a(f"РасчСчет={OTHER_ACC}")
    a(f"НачальныйОстаток={opening:.2f}")
    a(f"ВсегоПоступило={total_in:.2f}")
    a(f"ВсегоСписано={total_out:.2f}")
    a(f"КонечныйОстаток={closing:.2f}")
    a("КонецРасчСчет")
    for x in docs:
        a("СекцияДокумент=Платежное поручение")
        a(f"Номер={x['n']}")
        a(f"Дата={x['d'].strftime('%d.%m.%Y')}")
        a(f"Сумма={x['amt']:.2f}")
        if x["direction"] == "IN":
            a(f"ДатаПоступило={x['d'].strftime('%d.%m.%Y')}")
        else:
            a(f"ДатаСписано={x['d'].strftime('%d.%m.%Y')}")
        a(f"ПлательщикСчет={x['payer_acc']}")
        a(f"ПлательщикИНН={x['payer_inn']}")
        a(f"Плательщик1={x['payer']}")
        a(f"ПолучательСчет={x['receiver_acc']}")
        a(f"ПолучательИНН={x['receiver_inn']}")
        a(f"Получатель1={x['receiver']}")
        if x.get("receiver_bik"):
            a(f"ПолучательБИК={x['receiver_bik']}")
        a("ВидОплаты=01")
        a("Очередность=5")
        a(f"НазначениеПлатежа={x['purpose']}")
        a("КонецДокумента")
    a("КонецФайла")
    with open(dst, "w", encoding="cp1251", newline="\r\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"документов {len(docs)}, поступило {total_in:,.2f}, списано {total_out:,.2f}, остаток {closing:,.2f}")
    months = (end.year - start.year) * 12 + end.month - start.month
    print(f"чистая выручка (эквайринг) в среднем ≈ {total_in / max(months, 1):,.0f} ₽/мес")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
