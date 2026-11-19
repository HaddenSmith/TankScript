import { act, fireEvent, screen, within } from '@testing-library/react';

export async function openLanguageMenu() {
  const toggle = screen.getByLabelText('Language');
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    await act(async () => fireEvent.click(toggle));
  }
  return within(screen.getByRole('listbox'));
}

export async function selectTankLanguage(language) {
  const names = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python' };
  const menu = await openLanguageMenu();
  await act(async () => fireEvent.click(menu.getByRole('option', { name: names[language], exact: true })));
}
