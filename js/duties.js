/*
 * duties.js — Cleaning duty catalogue for the Bulka dormitory cell.
 *
 * Source: the official "ZÁSADY – provádění samoúklidu v pokojích ubytovacího
 * zařízení" sheet (Příloha č. 1). Each task keeps the original Czech wording
 * (cs) plus an English translation (en) so the sheet can be shown to the
 * dorm administration in Czech and understood by international roommates.
 *
 * Zones map the sheet's structure onto the four weekly duty roles:
 *   ROOM_A / ROOM_B  – "v pokoji" tasks, done by that room's members
 *   KITCHEN          – "v buňkách" kitchen tasks + daily trash
 *   BATHROOM         – "v buňkách" bathroom + WC tasks
 * Tasks that the sheet groups as "kuchyňky, koupelny, WC" (tiles / floors)
 * are split so the kitchen duty covers the kitchen part and the bathroom
 * duty covers the bathroom + WC part.
 */
(function (DORM) {
  'use strict';

  // freq: 'daily' | 'weekly' | 'monthly'
  // zone: 'ROOM' | 'KITCHEN' | 'BATHROOM'  (ROOM applies to both ROOM_A/ROOM_B roles)
  var TASKS = [
    // ---- DAILY (denně) ----
    { id: 'd_trash', freq: 'daily', zone: 'KITCHEN',
      cs: 'Vynést odpadkový koš do popelnic/kontejneru, odpad třídit dle druhu',
      en: 'Take the trash out to the bins/container, sort waste by type' },
    { id: 'd_air_room', freq: 'daily', zone: 'ROOM',
      cs: 'Řádně vyvětrat pokoj',
      en: 'Air out the room properly' },
    { id: 'd_bedding', freq: 'daily', zone: 'ROOM',
      cs: 'Provětrat lůžkoviny a uložit je do určeného prostoru',
      en: 'Air the bedding and store it in the designated space' },
    { id: 'd_kitchen', freq: 'daily', zone: 'KITCHEN',
      cs: 'Základní úklid kuchyňky – uklidit pracovní plochy, odstranit zbytky jídel',
      en: 'Basic kitchen clean-up – tidy worktops, remove food residue' },
    { id: 'd_food', freq: 'daily', zone: 'KITCHEN',
      cs: 'Zkontrolovat potraviny (expirační lhůty)',
      en: 'Check food (expiration dates)' },
    { id: 'd_bath', freq: 'daily', zone: 'BATHROOM',
      cs: 'Základní úklid koupelny a WC, udržovat čistotu po každém použití',
      en: 'Basic cleaning of the bathroom and WC, keep clean after each use' },

    // ---- WEEKLY (1x týdně) ----
    { id: 'w_floor_room', freq: 'weekly', zone: 'ROOM',
      cs: 'Umýt podlahu pokoje',
      en: 'Wash the room floor' },
    { id: 'w_surfaces', freq: 'weekly', zone: 'ROOM',
      cs: 'Umýt omyvatelný povrch stolů a jiného nábytku',
      en: 'Wipe washable surfaces of tables and other furniture' },
    { id: 'w_dust', freq: 'weekly', zone: 'ROOM',
      cs: 'Utřít prach na nábytku a okenním parapetu',
      en: 'Dust the furniture and windowsill' },
    { id: 'w_mirror', freq: 'weekly', zone: 'BATHROOM',
      cs: 'Umýt a vyleštit zrcadlo',
      en: 'Wash and polish the mirror' },
    { id: 'w_tiles_k', freq: 'weekly', zone: 'KITCHEN',
      cs: 'Umýt obklady kuchyňky',
      en: 'Wash the kitchen tiles' },
    { id: 'w_tiles_b', freq: 'weekly', zone: 'BATHROOM',
      cs: 'Umýt obklady koupelny a WC',
      en: 'Wash the bathroom and WC tiles' },
    { id: 'w_floor_k', freq: 'weekly', zone: 'KITCHEN',
      cs: 'Umýt a vydezinfikovat podlahu kuchyňky',
      en: 'Wash and disinfect the kitchen floor' },
    { id: 'w_floor_b', freq: 'weekly', zone: 'BATHROOM',
      cs: 'Umýt a vydezinfikovat podlahu koupelny a WC',
      en: 'Wash and disinfect the bathroom and WC floor' },
    { id: 'w_wc', freq: 'weekly', zone: 'BATHROOM',
      cs: 'Vydezinfikovat klozetovou mísu vč. sedátka, umyvadlo a sprchový kout',
      en: 'Disinfect the toilet bowl incl. seat, the sink and the shower' },

    // ---- MONTHLY (1x měsíčně) ----
    { id: 'm_doors', freq: 'monthly', zone: 'ROOM',
      cs: 'Umýt dveře, obklady stěn a okenní parapet',
      en: 'Wash the doors, wall tiles and windowsill' },
    { id: 'm_radiator', freq: 'monthly', zone: 'ROOM',
      cs: 'Vlhkým hadrem otřít otopná tělesa a stolní lampu',
      en: 'Wipe the radiators and desk lamp with a damp cloth' },
    { id: 'm_floor_room', freq: 'monthly', zone: 'ROOM',
      cs: 'Řádně umýt podlahu pokoje',
      en: 'Thoroughly wash the room floor' },
    { id: 'm_fridge', freq: 'monthly', zone: 'KITCHEN',
      cs: 'Odmrazit ledničku a řádně ji umýt zevnitř i zvenku',
      en: 'Defrost the fridge and wash it thoroughly inside and out' },
    { id: 'm_cabinets', freq: 'monthly', zone: 'KITCHEN',
      cs: 'Umýt povrch kuchyňských skříněk',
      en: 'Wash the surface of the kitchen cabinets' },
    { id: 'm_deep_k', freq: 'monthly', zone: 'KITCHEN',
      cs: 'Řádně umýt podlahy a obklady kuchyňky, dezinfikovat',
      en: 'Thoroughly wash the kitchen floor and tiles, disinfect' },
    { id: 'm_deep_b', freq: 'monthly', zone: 'BATHROOM',
      cs: 'Řádně umýt podlahy a obklady koupelny a WC, dezinfikovat',
      en: 'Thoroughly wash the bathroom and WC floors and tiles, disinfect' }
  ];

  // The four weekly duty roles.
  var ROLES = [
    { id: 'ROOM_A', zone: 'ROOM',     scope: 'roomA', icon: '🛏️' },
    { id: 'ROOM_B', zone: 'ROOM',     scope: 'roomB', icon: '🛏️' },
    { id: 'KITCHEN', zone: 'KITCHEN', scope: 'all',   icon: '🍳' },
    { id: 'BATHROOM', zone: 'BATHROOM', scope: 'all', icon: '🚿' }
  ];

  // Points earned per completed task, by frequency.
  var POINTS = { daily: 1, weekly: 4, monthly: 8 };

  /**
   * Tasks that belong to a given role for a given week.
   * Weekly + daily tasks appear every week; monthly tasks only in the
   * ISO week that contains the 1st of the month (the "monthly week").
   */
  function tasksForRole(roleId, isMonthlyWeek) {
    var role = ROLES.filter(function (r) { return r.id === roleId; })[0];
    if (!role) return [];
    return TASKS.filter(function (t) {
      if (t.zone !== role.zone) return false;
      if (t.freq === 'monthly') return !!isMonthlyWeek;
      return true;
    });
  }

  /** Maximum points a role's checklist is worth in a given week. */
  function maxPointsForRole(roleId, isMonthlyWeek) {
    return tasksForRole(roleId, isMonthlyWeek).reduce(function (sum, t) {
      return sum + (POINTS[t.freq] || 0);
    }, 0);
  }

  DORM.duties = {
    TASKS: TASKS,
    ROLES: ROLES,
    POINTS: POINTS,
    tasksForRole: tasksForRole,
    maxPointsForRole: maxPointsForRole
  };
})(window.DORM = window.DORM || {});
