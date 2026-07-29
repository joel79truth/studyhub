import { useContext } from 'react';
import { UserContext } from '../context/UserContext';

export function usePersonalisation() {
  return useContext(UserContext);
}