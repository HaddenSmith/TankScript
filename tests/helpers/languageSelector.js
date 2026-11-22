import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

export async function openLanguageMenu() {
  const toggle = screen.getByLabelText('Language');
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    await act(async () => fireEvent.click(toggle));
  }
  return within(document.querySelector('#tank-language-menu'));
}

export async function selectTankLanguage(language) {
  const names = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java — experimental' };
  const menu = await openLanguageMenu();
  await act(async () => fireEvent.click(menu.getByRole('option', { name: names[language], exact: true })));
}

export async function openSavedTankMenu() {
  const toggle = document.querySelector('#saved-tank');
  await waitFor(() => expect(toggle).toBeEnabled());
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    await act(async () => fireEvent.click(toggle));
  }
  return within(document.querySelector('#saved-tank-menu'));
}

export async function selectSavedTank(id) {
  const menu = await openSavedTankMenu();
  const option = menu.getAllByRole('option').find(option => option.value === id);
  if (!option) throw new Error('Saved tank not found: ' + id);
  await act(async () => fireEvent.click(option));
}
