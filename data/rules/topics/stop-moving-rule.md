---
title: Stop-moving rule
summary: When an effect is and isn't allowed to move a card.
group: Edge cases
order: 70
related: lose-track-rule, durations
---
This rule settles odd cases where two effects both try to move the same card. It replaced the older {rule:lose-track-rule} in 2019.

## The rule

- An effect can move a card if it says where the card is coming from, or if that same effect put the card where it is now. [official]
- If the card isn't where the effect expects it to be, or it moved away and then came back, the effect can't move it. [official]
  - A card you played expects to be in play. If it has already left play, it can't move itself. [official]
  - A gained card is expected to be wherever it was gained to, even if that isn't your discard pile. [official]
- A card in a discard pile can still be moved after other cards cover it. A card on top of a deck can't be moved once it's covered. [official]

## What still happens

- Only the movement fails. The rest of the effect still happens, unless it depends on the movement (for example "if you do"). [official]
- Example: {card:Throne Room} on {card:Mining Village}. On the first play you trash Mining Village for {coin:+2}. On the second play it's no longer in play, so it can't trash itself and you don't get the {coin:+2}. You still get +1 Card and +2 Actions both times.

## When it comes up

- Cards that move themselves (one-shots returning to their pile, Travellers exchanging, Reserves going onto your mat) after something else has already moved them.
- Cards that move other cards, such as cards that put a gained card onto your deck or move cards out of your discard pile.
- Cards that keep others from moving, such as {card:Band of Misfits}, {card:Captain}, {card:Prince} and {card:Way of the Mouse}.
