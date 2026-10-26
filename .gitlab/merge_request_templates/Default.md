<!-- 🤖 TÂCHE IA — AVANT de créer la MR :
Analyse la gravité des changements (diff vs branche cible) et remplace la ligne /label en fin de template par UNE seule étiquette :
- review::quick : diff réduit (< ~50 lignes), périmètre unique, aucune logique métier (typo, i18n, config, renommage, fix trivial)
- review::standard : feature/fix classique, diff modéré, logique métier touchée, tests à jour
- review::complex : gros diff ou multi-composants, migration/schéma de données, sécurité, perf, architecture, API publique, risque de régression élevé
En cas de doute entre deux niveaux, choisir le plus élevé.
-->

## Bug / Problème

#### Fonctionnel
<!-- Ce que l'utilisateur observe, l'impact métier -->

#### Technique
 <!-- Cause racine, composant concerné, pourquoi ça casse -->

## Solution
<!-- Explique l'approche choisie et pourquoi -->

## Comment tester

## Screenshots (si applicable)
<!--

|  before  |  after  |
|----|----|
| <insert before screenshot here> | <insert after screenshot here> |

-->

## Ticket lié

Dans le message du commit : `fixes <ID>` (ex. `fixes RM-123456` ou `fixes DESKTOP-1234`), mot-clé `fixes` requis (un lien seul ne suffit pas) => Sentry résoudra l'issue à la release suivante.

<!-- IA : remplacer la ligne ci-dessous par UNE seule étiquette : review::quick, review::standard ou review::complex -->
/label review::standard

/assign me  
/reviewer @boris.trombert @aurelien.sberro @eliott.scherrer
/remove_reviewer me  
