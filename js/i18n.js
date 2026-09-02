/*
 * i18n.js — Czech (cs) + English (en) interface strings.
 * The app content lives here; roommates switch language with one click.
 */
(function (DORM) {
  'use strict';

  var STR = {
    cs: {
      app_name: 'Bulka — správa buňky',
      app_tagline: 'Úklid, služby a společné výdaje pro 8 spolubydlících',

      // tabs
      tab_today: 'Dnes',
      tab_roster: 'Rozpis služeb',
      tab_expenses: 'Výdaje',
      tab_leaderboard: 'Body',
      tab_settings: 'Nastavení',

      // roles
      role_ROOM_A: 'Malý pokoj',
      role_ROOM_B: 'Velký pokoj',
      role_KITCHEN: 'Kuchyňka + koš',
      role_BATHROOM: 'Koupelna + WC',

      // frequencies
      freq_daily: 'Denně',
      freq_weekly: 'Týdně',
      freq_monthly: 'Měsíčně',

      // today
      today_title: 'Tento týden',
      week_label: 'Týden',
      monthly_week_badge: 'Měsíční úklid tento týden',
      on_duty: 'Ve službě',
      your_turn: 'Jsi na řadě!',
      checklist: 'Seznam úkolů',
      mark_done: 'Hotovo',
      done: 'Splněno',
      progress: 'Průběh',
      swap: 'Předat službu',
      nobody: '—',
      no_members_hint: 'Nejprve přidej spolubydlící v Nastavení.',

      // roster
      roster_title: 'Rozpis služeb (kdo, co, kdy)',
      roster_prev: '‹ Předchozí',
      roster_next: 'Další ›',
      roster_this_week: 'Tento týden',
      fairness_title: 'Vyváženost služeb',
      fairness_hint: 'Kolikrát každý sloužil (systém dává další službu tomu, kdo zaostává).',
      duties_count: 'služeb',

      // swap dialog
      swap_title: 'Předat službu',
      swap_desc: 'Kdo tuto službu převezme? Body získá ten, kdo úkol opravdu udělá.',
      swap_to: 'Převezme',
      swap_note: 'Poznámka (nepovinné, např. „pryč 12.–20. 9.“)',
      swap_confirm: 'Předat',
      swap_reset: 'Vrátit původnímu',
      cancel: 'Zrušit',

      // expenses
      expenses_title: 'Společné výdaje',
      exp_who_owes: 'Kdo komu dluží',
      exp_all_settled: 'Všichni vyrovnáni 🎉',
      exp_add: 'Přidat výdaj',
      exp_desc: 'Co bylo koupeno',
      exp_amount: 'Částka',
      exp_payer: 'Zaplatil(a)',
      exp_split: 'Rozdělit mezi',
      exp_split_all: 'Všechny',
      exp_category: 'Kategorie',
      exp_save: 'Uložit výdaj',
      exp_history: 'Historie',
      exp_paid_by: 'zaplatil(a)',
      exp_for: 'pro',
      exp_settle: 'Vyrovnat',
      exp_settle_confirm: 'Označit jako zaplaceno?',
      exp_delete: 'Smazat',
      exp_none: 'Zatím žádné výdaje.',
      exp_owes: 'dluží',
      exp_gets: 'dostane zpět',
      exp_balance: 'Bilance',
      cat_hygiene: 'Hygiena (mýdlo, papír)',
      cat_cleaning: 'Úklidové prostředky',
      cat_kitchen: 'Kuchyň',
      cat_other: 'Ostatní',
      exp_karma_hint: 'Za nákup pro buňku +5 karmy kupujícímu.',

      // leaderboard / privileges
      lb_title: 'Body a výhody',
      lb_points: 'bodů',
      lb_tier: 'Úroveň',
      lb_tokens: 'Žetony imunity',
      lb_tokens_hint: 'Za body získáváš žetony — jedním můžeš vynechat jeden drobný úkol.',
      lb_use_token: 'Použít žeton',
      lb_rules_title: 'Jak to funguje',
      lb_rule_1: 'Splněný úkol = body (denní 1, týdenní 4, měsíční 8).',
      lb_rule_2: 'Nákup pro buňku = +5 karmy (a peníze se ti vrátí).',
      lb_rule_3: 'Kdo zaostává, dostane další službu — rozpis se sám vyrovnává.',
      lb_rule_4: 'Vyšší úroveň = přednostní výběr týdne a žetony imunity.',
      tier_bronze: 'Bronz',
      tier_silver: 'Stříbro',
      tier_gold: 'Zlato',
      tier_platinum: 'Platina',

      // settings
      settings_title: 'Nastavení',
      set_members: 'Spolubydlící (8 osob)',
      set_member_name: 'Jméno',
      set_member_room: 'Pokoj',
      set_room_a: 'Malý pokoj',
      set_room_b: 'Velký pokoj',
      set_add_member: 'Přidat osobu',
      set_remove: 'Odebrat',
      set_start_date: 'Začátek rozpisu',
      set_currency: 'Měna',
      set_language: 'Jazyk',
      set_data: 'Data a synchronizace',
      set_sync_hint: 'Data se ukládají v tomto prohlížeči. Pro sdílení mezi telefony zapni synchronizaci (Supabase, zdarma) níže.',
      set_sync_url: 'Supabase URL',
      set_sync_key: 'Supabase anon key',
      set_sync_save: 'Uložit a synchronizovat',
      set_sync_off: 'Vypnout synchronizaci',
      set_export: 'Exportovat data',
      set_import: 'Importovat data',
      set_reset: 'Vymazat vše',
      set_reset_confirm: 'Opravdu smazat všechna data?',
      set_seed: 'Vyplnit ukázkovými jmény',
      set_max_members: 'Maximálně 8 spolubydlících.',

      save: 'Uložit',
      added: 'Přidáno',
      saved: 'Uloženo'
    },

    en: {
      app_name: 'Bulka — cell manager',
      app_tagline: 'Cleaning duties, rota and shared expenses for 8 roommates',

      tab_today: 'Today',
      tab_roster: 'Rota',
      tab_expenses: 'Expenses',
      tab_leaderboard: 'Points',
      tab_settings: 'Settings',

      role_ROOM_A: 'Small room',
      role_ROOM_B: 'Large room',
      role_KITCHEN: 'Kitchen + trash',
      role_BATHROOM: 'Bathroom + WC',

      freq_daily: 'Daily',
      freq_weekly: 'Weekly',
      freq_monthly: 'Monthly',

      today_title: 'This week',
      week_label: 'Week',
      monthly_week_badge: 'Monthly deep-clean this week',
      on_duty: 'On duty',
      your_turn: "It's your turn!",
      checklist: 'Checklist',
      mark_done: 'Done',
      done: 'Completed',
      progress: 'Progress',
      swap: 'Hand over',
      nobody: '—',
      no_members_hint: 'Add your roommates in Settings first.',

      roster_title: 'Duty rota (who, what, when)',
      roster_prev: '‹ Previous',
      roster_next: 'Next ›',
      roster_this_week: 'This week',
      fairness_title: 'Duty balance',
      fairness_hint: 'How many times each person has served (the system gives the next duty to whoever is behind).',
      duties_count: 'duties',

      swap_title: 'Hand over duty',
      swap_desc: 'Who takes this duty over? Points go to whoever actually does it.',
      swap_to: 'Taken over by',
      swap_note: 'Note (optional, e.g. "away 12–20 Sep")',
      swap_confirm: 'Hand over',
      swap_reset: 'Reset to default',
      cancel: 'Cancel',

      expenses_title: 'Shared expenses',
      exp_who_owes: 'Who owes whom',
      exp_all_settled: 'Everyone is settled 🎉',
      exp_add: 'Add expense',
      exp_desc: 'What was bought',
      exp_amount: 'Amount',
      exp_payer: 'Paid by',
      exp_split: 'Split between',
      exp_split_all: 'Everyone',
      exp_category: 'Category',
      exp_save: 'Save expense',
      exp_history: 'History',
      exp_paid_by: 'paid by',
      exp_for: 'for',
      exp_settle: 'Settle up',
      exp_settle_confirm: 'Mark as paid?',
      exp_delete: 'Delete',
      exp_none: 'No expenses yet.',
      exp_owes: 'owes',
      exp_gets: 'gets back',
      exp_balance: 'Balance',
      cat_hygiene: 'Hygiene (soap, paper)',
      cat_cleaning: 'Cleaning supplies',
      cat_kitchen: 'Kitchen',
      cat_other: 'Other',
      exp_karma_hint: 'Buying for the cell gives +5 karma to the buyer.',

      lb_title: 'Points & perks',
      lb_points: 'pts',
      lb_tier: 'Tier',
      lb_tokens: 'Immunity tokens',
      lb_tokens_hint: 'Points earn tokens — spend one to skip a small task.',
      lb_use_token: 'Use token',
      lb_rules_title: 'How it works',
      lb_rule_1: 'Completed task = points (daily 1, weekly 4, monthly 8).',
      lb_rule_2: 'Buying for the cell = +5 karma (and your money comes back).',
      lb_rule_3: 'Whoever is behind gets the next duty — the rota self-balances.',
      lb_rule_4: 'Higher tier = priority week pick and immunity tokens.',
      tier_bronze: 'Bronze',
      tier_silver: 'Silver',
      tier_gold: 'Gold',
      tier_platinum: 'Platinum',

      settings_title: 'Settings',
      set_members: 'Roommates (8 people)',
      set_member_name: 'Name',
      set_member_room: 'Room',
      set_room_a: 'Small room',
      set_room_b: 'Large room',
      set_add_member: 'Add person',
      set_remove: 'Remove',
      set_start_date: 'Rota start date',
      set_currency: 'Currency',
      set_language: 'Language',
      set_data: 'Data & sync',
      set_sync_hint: 'Data is stored in this browser. To share across phones, enable sync (Supabase, free) below.',
      set_sync_url: 'Supabase URL',
      set_sync_key: 'Supabase anon key',
      set_sync_save: 'Save & sync',
      set_sync_off: 'Turn off sync',
      set_export: 'Export data',
      set_import: 'Import data',
      set_reset: 'Erase everything',
      set_reset_confirm: 'Really erase all data?',
      set_seed: 'Fill with sample names',
      set_max_members: 'Maximum 8 roommates.',

      save: 'Save',
      added: 'Added',
      saved: 'Saved'
    }
  };

  var current = 'cs';

  function setLang(l) { if (STR[l]) current = l; }
  function getLang() { return current; }
  function t(key) {
    var d = STR[current] || STR.cs;
    return (key in d) ? d[key] : (STR.cs[key] || key);
  }

  DORM.i18n = { STR: STR, setLang: setLang, getLang: getLang, t: t };
})(window.DORM = window.DORM || {});
