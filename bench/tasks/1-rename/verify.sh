#!/usr/bin/env bash
# Pass: no formatPrice left, formatMoney exported, the cart tests still pass.
! grep -rn "formatPrice" src tests && grep -q "export function formatMoney" src/format.ts && bun test tests/cart.spec.ts
