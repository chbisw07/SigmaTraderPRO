import { render, screen } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'

import { Providers } from '@/app/Providers'
import { createTestRouter } from '@/routes/router'

test('renders the app shell', () => {
  const router = createTestRouter(['/'])
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )

  expect(screen.getAllByText('SigmaTraderPRO').length).toBeGreaterThan(0)
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
})
