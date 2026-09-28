import { motion } from 'framer-motion';
import { ContactsTable } from '../../components/crm/ContactsTable';

export function LeadsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <ContactsTable />
    </motion.div>
  );
}
