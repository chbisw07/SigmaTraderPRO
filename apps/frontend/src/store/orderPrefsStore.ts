import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { OrderProduct, OrderType } from '@/lib/api/orders'

type OrderPrefsState = {
  stockProduct: OrderProduct
  stockOrderType: OrderType
  fnoProduct: 'MIS' | 'NRML'
  fnoOrderType: OrderType

  setStockProduct: (product: OrderProduct) => void
  setStockOrderType: (orderType: OrderType) => void
  setFnoProduct: (product: 'MIS' | 'NRML') => void
  setFnoOrderType: (orderType: OrderType) => void
}

export const useOrderPrefsStore = create<OrderPrefsState>()(
  persist(
    (set) => ({
      stockProduct: 'CNC',
      stockOrderType: 'MARKET',
      fnoProduct: 'NRML',
      fnoOrderType: 'LIMIT',

      setStockProduct: (product) => set({ stockProduct: product }),
      setStockOrderType: (orderType) => set({ stockOrderType: orderType }),
      setFnoProduct: (product) => set({ fnoProduct: product }),
      setFnoOrderType: (orderType) => set({ fnoOrderType: orderType }),
    }),
    {
      name: 'sigmatraderpro.order_prefs',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)

